# SkieePay — XPAYPOINT Payment Engine

SkieePay is the private payment-engine project for XPAYPOINT. It is kept separate from the live checkout while the core is built and tested.

## Current scaffold
- `index.html`: responsive operations dashboard shell.
- Planned backend modules: invoice API, QR payload/rendering, payment event ingestion, ledger, signed webhook, reconciliation, and VIPayment fulfillment handoff.

## Non-negotiable payment safety
- A generated QR image is not proof that funds were received.
- Never mark an invoice paid from a browser request or a customer-supplied screenshot.
- Only accept a payment event from a trusted, authenticated source and reconcile it against amount, destination, reference, and transaction identity.
- Keep provider credentials and signing secrets in server-side environment variables only.
- Use idempotency keys so retries cannot fulfill an order twice.

## Next implementation stages
1. Create Supabase schema for invoices, payment events, and immutable ledger entries.
2. Implement Cloudflare Worker endpoints: `POST /v1/invoices`, `GET /v1/invoices/:id`, and authenticated `POST /v1/events/payment`.
3. Add a verified funds-reconciliation adapter. QR payload generation can be implemented, but payment receipt must be connected to a real supported payment rail before live use.
4. Connect successful verified invoices to the existing VIPayment fulfillment function.
5. Run end-to-end tests with small test payments before production activation.

## Deployment
Cloudflare Pages serves this folder at `/skieepay/` after the repository's Pages build deploys.
