# XPAYPOINT Autonomous CTO Agent (Level 2)

A separate Cloudflare Worker for XPAYPOINT engineering operations. It does not replace the storefront Workers and does not deploy to the storefront.

## Architecture

- Cloudflare Workers + Agents SDK Durable Object.
- Durable scheduler runs a monitoring cycle every 300 seconds.
- OpenAI Agents API (managed Codex harness) is invoked only when a new actionable alert appears.
- A private MCP endpoint exposes a small, allow-listed GitHub toolset.
- GitHub writes are restricted to `autopilot/*` branches and pull requests targeting `main`.
- There is no merge, deployment, production database, payment, wallet, or secret-management tool.

## Guardrails

The MCP server enforces these rules server-side:

- No writes to `main`; development branches must match `autopilot/<short-slug>`.
- Pull requests can target only `main`; opening a PR never merges it.
- File writes are limited to `cto-agent/src/**`, `cto-agent/tests/**`, `hq/**`, `docs/**`, `governance/**`, and `README.md`.
- Storefront and protected files are blocked, including `index.html`, `topup.html`, `profil.html`, `cek-pesanan.html`, `admin-vipayment.html`, database/migration paths, deployment config, and GitHub workflow files.
- The agent has no tools for payments, balances, XPAYCOIN, Supabase writes, Cloudflare deployments, credentials, merges, or rollbacks.
- The agent must report protected issues for Founder approval.

## Runtime setup

1. Review and merge this PR manually. The agent must never merge its own work.
2. In GitHub Actions, add repository secrets:
   - `CLOUDFLARE_API_TOKEN`: token limited to Workers Scripts:Edit for this account.
   - `CLOUDFLARE_ACCOUNT_ID`: the XPAYPOINT Cloudflare account ID.
3. In Cloudflare, create runtime secrets for the new Worker `xpaypoint-cto-agent-dev`:
   - `ADMIN_TOKEN`: a unique random token (at least 32 characters).
   - `MCP_AUTH_TOKEN`: a different unique random token (at least 32 characters).
   - `GITHUB_TOKEN`: a fine-grained token scoped only to `xpaypoint`, with Contents: Read and write, Pull requests: Read and write, Actions: Read, Metadata: Read.
   - `OPENAI_API_KEY`: an OpenAI Platform API key with `api.agents.read`, `api.agents.write`, and `api.responses.write`.
4. Keep the Worker variable `AUTOPILOT_ENABLED=false` while validating. The other non-secret defaults are in `wrangler.jsonc`.
5. From GitHub Actions, run **XPAYPOINT CTO Agent - Deploy Dev** manually. This deploys only the separate `xpaypoint-cto-agent-dev` Worker.
6. Confirm `GET /health` returns `ok: true`.
7. Send `POST /start` with `Authorization: Bearer <ADMIN_TOKEN>`. This initializes the Durable Object and its five-minute scheduler. The first run performs monitoring only while autopilot is disabled.
8. Check the authenticated status returned by `POST /start`. Only after confirming the setup, set `AUTOPILOT_ENABLED=true` in the Worker variables. The next new alert may start a managed coding session.

Do not paste tokens or API keys into GitHub issues, PRs, chat, or source files. Set them only in the relevant secret stores.

## Cost and cadence

- No VPS is required. The Durable Object hibernates between scheduled work.
- Monitoring runs every five minutes. AI coding sessions are event-driven and deduplicated by alert signature; the agent does not call the model on every heartbeat.
- Cloudflare Durable Objects have a Free allocation, but usage beyond included limits may require a paid Workers plan.
- OpenAI Agents API model and hosted sandbox usage are billed separately at Platform API rates. A ChatGPT subscription does not include API credits.
- This Worker is a development assistant, not a payment processor or storefront availability guarantee.

## Local checks

```bash
npm install
npm run check
```

## Endpoints

- `GET /health`: public, non-sensitive liveness response.
- `POST /start`: requires `ADMIN_TOKEN`; initializes the scheduled Durable Object.
- `/mcp`: requires `MCP_AUTH_TOKEN`; exposes only the allow-listed repository tools.
- `/agents/*`: requires `ADMIN_TOKEN`; internal Agent SDK route.
