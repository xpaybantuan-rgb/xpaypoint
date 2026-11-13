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
  const bytes = crypto.getRandomValues(new Uint8Array(8));
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
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return reply({ ok: true, service: "SkieePay", mode: "foundation", live_payments: false });
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
