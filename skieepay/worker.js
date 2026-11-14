const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-SkieePay-Key,X-Idempotency-Key"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
  });
}
function jsonError(message, status = 400) { return reply({ ok: false, error: message }, status); }
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "SKP" + [...bytes].map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}
async function db(env, path, init = {}) {
  const url = env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {})
    }
  });
  const body = await res.text();
  if (!res.ok) throw new Error("Database request failed (" + res.status + "): " + body.slice(0, 300));
  return body ? JSON.parse(body) : null;
}
function authorized(request, env) {
  const key = request.headers.get("X-SkieePay-Key") || "";
  return !!env.SKIEEPAY_API_KEY && key.length === env.SKIEEPAY_API_KEY.length &&
    [...key].reduce((n, c, i) => n | (c.charCodeAt(0) ^ env.SKIEEPAY_API_KEY.charCodeAt(i)), 0) === 0;
}
// MD5 implementation for VIPayment's documented callback signature.
// Web Crypto does not provide MD5, so do not call crypto.subtle.digest("MD5").
function md5Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  const shifts = [
    7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21
  ];
  const k = Array.from({length:64}, (_,i) => Math.floor(Math.abs(Math.sin(i+1))*0x100000000) >>> 0);
  let a0=0x67452301, b0=0xefcdab89, c0=0x98badcfe, d0=0x10325476;
  const rotl = (x,n) => (x << n) | (x >>> (32-n));

  for (let offset=0; offset<paddedLength; offset+=64) {
    const words = new Uint32Array(16);
    for (let j=0; j<16; j++) words[j]=view.getUint32(offset+j*4,true);
    let a=a0,b=b0,c=c0,d=d0;
    for (let i=0; i<64; i++) {
      let f,g;
      if (i<16) { f=(b & c) | (~b & d); g=i; }
      else if (i<32) { f=(d & b) | (~d & c); g=(5*i+1)%16; }
      else if (i<48) { f=b ^ c ^ d; g=(3*i+5)%16; }
      else { f=c ^ (b | ~d); g=(7*i)%16; }
      const sum=(a+f+k[i]+words[g]) >>> 0;
      const next=(b+rotl(sum,shifts[i])) >>> 0;
      a=d; d=c; c=b; b=next;
    }
    a0=(a0+a)>>>0; b0=(b0+b)>>>0; c0=(c0+c)>>>0; d0=(d0+d)>>>0;
  }
  return [a0,b0,c0,d0].map(word =>
    [0,8,16,24].map(shift => ((word>>>shift)&255).toString(16).padStart(2,"0")).join("")
  ).join("");
}
function vipaymentSignature(env) {
  if (!env.VIPAYMENT_API_ID || !env.VIPAYMENT_API_KEY) return null;
  return md5Hex(env.VIPAYMENT_API_ID + env.VIPAYMENT_API_KEY);
}
async function vipaymentCallback(request, env) {
  const expected = await vipaymentSignature(env);
  if (!expected) return jsonError("VIPayment API credentials are not configured", 503);
  const sourceIp = request.headers.get("CF-Connecting-IP") || "";
  if (env.VIPAYMENT_ENFORCE_IP !== "false" && sourceIp !== "178.248.73.218") {
    return jsonError("Callback source IP is not allowed", 403);
  }
  const supplied = (request.headers.get("X-Client-Signature") || "").trim().toLowerCase();
  if (!supplied || supplied.length !== expected.length ||
      [...supplied].reduce((n, c, i) => n | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) !== 0) {
    return jsonError("Invalid VIPayment callback signature", 401);
  }
  const raw = await request.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { return jsonError("Invalid JSON payload"); }
  const item = payload?.data?.trxid ? payload.data : payload;
  const trxid = String(item?.trxid || "").trim();
  const status = String(item?.status || "").toLowerCase();
  const note = item?.note == null ? null : String(item.note).slice(0, 1000);
  const price = Number.isSafeInteger(Number(item?.price)) ? Number(item.price) : null;
  if (!trxid || !["waiting", "processing", "success", "error"].includes(status)) {
    return jsonError("Missing trxid or unsupported status");
  }
  const result = await db(env, "rpc/skieepay_apply_vipayment_callback", {
    method: "POST",
    body: JSON.stringify({
      p_trxid: trxid,
      p_status: status,
      p_note: note,
      p_price: price,
      p_payload: payload
    })
  });
  return reply({ ok: true, provider: "VIPayment", result });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return reply({ ok: true, service: "SkieePay", mode: "vipayment-webhook-ready", vipayment_webhook: !!(env.VIPAYMENT_API_ID && env.VIPAYMENT_API_KEY), live_payments: false });
    }
    const publicInvoiceMatch = url.pathname.match(/^\\/public\\/invoices\\/(SKP[0-9A-F]{16}|SKP[0-9A-F]{32})$/i);
    if (publicInvoiceMatch && request.method === "GET") {
      try {
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return jsonError("Server is not configured", 503);
        const code = publicInvoiceMatch[1].toUpperCase();
        const rows = await db(env, "skieepay_invoices?invoice_code=eq." + encodeURIComponent(code) +
          "&select=invoice_code,amount,currency,status,payment_method,payment_payload,expires_at,created_at,paid_at&limit=1");
        if (!rows.length) return jsonError("Invoice not found", 404);
        return new Response(JSON.stringify({ ok: true, invoice: rows[0] }), {
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors }
        });
      } catch (error) {
        return jsonError(error.message || "Invoice lookup failed", 500);
      }
    }
    if (url.pathname === "/webhooks/vipayment" && request.method === "POST") {
      try { return await vipaymentCallback(request, env); }
      catch (error) { return jsonError(error.message || "Callback processing failed", 500); }
    }
    if (url.pathname === "/webhooks/payment" && request.method === "POST") {
      return jsonError("Payment rail webhook is not configured. No invoice was marked paid.", 501);
    }
    if (!authorized(request, env)) return jsonError("Unauthorized", 401);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return jsonError("Server is not configured", 503);

    try {
      if (url.pathname === "/v1/invoices" && request.method === "POST") {
        const body = await request.json();
        const amount = Number(body.amount);
        if (!Number.isSafeInteger(amount) || amount < 1) return jsonError("amount must be a positive integer in IDR");
        const expiresMinutes = Math.min(1440, Math.max(5, Number(body.expires_minutes) || 30));
        const invoice = {
          invoice_code: randomCode(),
          order_id: body.order_id || null,
          customer_ref: body.customer_ref ? String(body.customer_ref).slice(0, 120) : null,
          amount,
          currency: "IDR",
          status: "pending",
          payment_method: body.payment_method || null,
          expires_at: new Date(Date.now() + expiresMinutes * 60000).toISOString()
        };
        const rows = await db(env, "skieepay_invoices", {
          method: "POST", body: JSON.stringify(invoice)
        });
        return reply({ ok: true, invoice: rows[0] }, 201);
      }
      const vipMatch = url.pathname.match(/^\/v1\/invoices\/([0-9a-f-]{36})\/vipayment$/i);
      if (vipMatch && request.method === "POST") {
        const body = await request.json();
        const trxid = String(body.trxid || "").trim();
        if (!trxid || trxid.length > 120) return jsonError("A valid VIPayment trxid is required");
        const rows = await db(env, "skieepay_invoices?id=eq." + encodeURIComponent(vipMatch[1]) + "&select=id,status", {
          method: "PATCH",
          body: JSON.stringify({ vipayment_trxid: trxid, fulfillment_status: "waiting", updated_at: new Date().toISOString() })
        });
        if (!rows || !rows.length) return jsonError("Invoice not found", 404);
        return reply({ ok: true, invoice: rows[0] });
      }
      const match = url.pathname.match(/^\/v1\/invoices\/([0-9a-f-]{36})$/i);
      if (match && request.method === "GET") {
        const rows = await db(env, "skieepay_invoices?id=eq." + encodeURIComponent(match[1]) + "&select=*");
        if (!rows.length) return jsonError("Invoice not found", 404);
        return reply({ ok: true, invoice: rows[0] });
      }
      if (url.pathname === "/v1/events/payment" && request.method === "POST") {
        return jsonError("Payment verification adapter is not connected. No invoice was marked paid.", 501);
      }
      return jsonError("Route not found", 404);
    } catch (error) {
      return jsonError(error.message || "Internal error", 500);
    }
  }
};
