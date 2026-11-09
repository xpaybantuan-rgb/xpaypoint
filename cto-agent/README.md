# XPAYPOINT Autonomous CTO Agent — Free-first Level 2

Separate Cloudflare Worker; it does not replace storefront Workers or deploy to the storefront.

## Architecture
- Cloudflare Workers + Agents SDK Durable Object.
- Monitoring every 5 minutes and a proactive engineering audit daily at 09:00 WIB.
- Gemini 2.5 Flash through Google AI Studio Free Tier, subject to model/project quotas.
- GitHub API tools are allow-listed; writes only to autopilot/* branches and PRs to main.
- No OpenAI API, OpenAI-hosted sandbox, VPS, or paid scheduler.

## Level 2 safety
- No merge, deployment, rollback, production database, payment, wallet, XPAYCOIN, customer transaction, or credential-management tools.
- Writes limited to cto-agent/src/**, cto-agent/tests/**, hq/**, docs/**, governance/**, README.md.
- Storefront/payment files, database/migration paths, secrets, deployment config and GitHub workflow files are blocked.
- All changes require Founder review through PRs. AUTOPILOT_ENABLED=false by default.

## Runtime setup
1. Create a GitHub fine-grained token for this repository: Contents read/write, Pull requests read/write, Actions read, Metadata read.
2. Add Cloudflare Worker secrets: ADMIN_TOKEN (unique random 32+ chars), GITHUB_TOKEN, GEMINI_API_KEY (Google AI Studio Free Tier).
3. Keep AUTOPILOT_ENABLED=false while testing.
4. Deploy only xpaypoint-cto-agent-dev using the manual GitHub Actions workflow.
5. Confirm GET /health, then POST /start with Authorization: Bearer <ADMIN_TOKEN>.
6. Verify monitoring. Only then set AUTOPILOT_ENABLED=true.

Never put tokens in source, PRs, issues or chat. Google AI Studio Free Tier content may be used to improve Google products; never send secrets, customer data or sensitive production records.

## Cost notes
- Public repository: GitHub Actions hosted runners are free under GitHub's public-repository policy.
- Cloudflare Workers Free and SQLite Durable Objects have included quotas; five-minute monitoring is 288 cycles/day.
- Gemini 2.5 Flash has free quotas with RPM/TPM/RPD limits that may change.
- No OpenAI API charges and no VPS. Free does not mean unlimited.
- The service is engineering automation, not a payment processor or storefront uptime guarantee.

## Endpoints
- GET /health: public liveness only.
- POST /start and /agents/*: require ADMIN_TOKEN.
