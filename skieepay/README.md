# SkieePay — standalone payment engine

SkieePay runs separately from the XPAYPOINT storefront.

## Implemented foundation
- Invoice creation and lookup through the Cloudflare Worker.
- Supabase invoice, payment-event, and ledger tables with RLS enabled.
- VIPayment callback receiver at `POST /webhooks/vipayment`.
- VIPayment callback signature validation using the precomputed MD5 value supplied in `X-Client-Signature`.
- VIPayment callback source IP allowlist (official VIPayment docs list `178.248.73.218`).
- Idempotent callback event storage and invoice fulfillment status updates.
- Link a VIPayment transaction to an invoice using `POST /v1/invoices/:id/vipayment`.

## Worker URLs
- Health: `https://skieepay-api.xpaybantuan.workers.dev/health`
- VIPayment callback: `https://skieepay-api.xpaybantuan.workers.dev/webhooks/vipayment`

Set this callback URL in VIPayment API settings.

## Cloudflare Worker variables and secrets
Set these in Cloudflare → Workers & Pages → `skieepay-api` → Settings → Variables and Secrets:

| Name | Type | Value |
|---|---|---|
| `SUPABASE_URL` | Variable | `https://rjgeitbkpcyymgemcztx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Supabase service-role key |
| `SKIEEPAY_API_KEY` | Secret | A long random server API key |
| `VIPAYMENT_API_ID` | Secret | VIPayment API ID |
| `VIPAYMENT_API_KEY` | Secret | VIPayment API key; Worker calculates the callback signature server-side |
| `VIPAYMENT_ENFORCE_IP` | Variable (optional) | Keep unset or set `true` to enforce the documented source IP |

Never put service-role keys, API keys, or callback secrets in frontend code or GitHub.

## API
- `GET /health`
- `GET /public/invoices/:invoice_code` — public, read-only invoice status; invoice code is an unguessable public reference
- `POST /v1/invoices` — requires `X-SkieePay-Key`
- `GET /v1/invoices/:uuid` — requires `X-SkieePay-Key`
- `POST /v1/invoices/:uuid/vipayment` — requires `X-SkieePay-Key`; stores the VIPayment `trxid` on the invoice
- `POST /webhooks/vipayment` — validates VIPayment callback signature and source IP

## Customer invoice page
- Static page: `invoice.html?code=SKP...`.
- The page reads only a small allowlist of public invoice fields and refreshes status automatically.
- New invoice codes use 128-bit random values. Existing 64-bit invoice codes remain supported.

## Payment QR and proof of funds
VIPayment is the game/top-up supplier, not the merchant payment-acquiring rail. Its callback reports the fulfillment status of a VIPayment order; it does not prove that the buyer paid SkieePay. The generic payment webhook intentionally remains disabled until a real payment provider/merchant QRIS source is connected.

A QR code containing an invoice URL or reference is not a QRIS payment QR. Do not mark an invoice `paid` based on a QR scan, redirect, screenshot, or customer button. Only a trusted provider notification plus amount/reference reconciliation can confirm funds.

## Security
- Keep all provider credentials in Cloudflare secrets.
- The browser must never mark invoices paid.
- Use idempotency and reconcile amount, invoice reference, merchant destination, and provider transaction ID.
- Do not trigger VIPayment fulfillment until the payment invoice has been independently confirmed as paid.
