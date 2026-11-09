import { Agent, routeAgentRequest } from "agents";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

interface Env {
  XPayPointCTOAgent: DurableObjectNamespace;
  REPO_OWNER: string;
  REPO_NAME: string;
  SITE_URL: string;
  AUTOPILOT_ENABLED: string;
  OPENAI_AGENT_MODEL?: string;
  OPENAI_API_KEY?: string;
  GITHUB_TOKEN?: string;
  MCP_AUTH_TOKEN?: string;
  ADMIN_TOKEN?: string;
}

interface CTOState {
  lastCheckAt: string | null;
  siteStatus: "healthy" | "unhealthy" | "unknown";
  latestWorkflow: string | null;
  openPullRequests: number;
  lastAlertSignature: string | null;
  lastSessionId: string | null;
  lastSessionAt: string | null;
  lastError: string | null;
  mcpServerUrl: string | null;
}

const initialState: CTOState = {
  lastCheckAt: null,
  siteStatus: "unknown",
  latestWorkflow: null,
  openPullRequests: 0,
  lastAlertSignature: null,
  lastSessionId: null,
  lastSessionAt: null,
  lastError: null,
  mcpServerUrl: null,
};

const CTO_INSTRUCTIONS = `
You are XPAYPOINT's autonomous CTO coding agent, operating under Founder-authorized Level 2 governance.

Allowed:
- Read the public XPAYPOINT repository and inspect open pull requests, review feedback, and CI.
- Diagnose issues, edit permitted files on branches named autopilot/<short-slug>, run relevant tests in your sandbox, and open pull requests targeting main.
- Report actual test results and any unavailable checks.

Never:
- Merge, deploy, release, rollback, or write to main.
- Change production databases, Supabase schema or records, payment providers/configuration, payment/checkout/fulfillment flows, customer transactions, balances, wallets, XPAYCOIN, deposits, withdrawals, cashback, rewards, ledgers, or refunds.
- Change secrets, credentials, GitHub/Cloudflare settings, Worker bindings, or deployment configuration.
- Modify protected customer/payment pages. The MCP server enforces file-path restrictions; do not attempt to bypass them.
- Claim a test passed unless you ran it and observed the result. Never include secrets in code, output, comments, or PRs.

Use only the supplied XPAYPOINT MCP tools for repository writes. The available tools deliberately do not include merge, deployment, secrets, database, or payment operations. If a task touches a protected area, stop and report that Founder approval is required. Keep changes narrow, explain risks, and open a PR for Founder review.
`.trim();

const ALLOWED_MCP_TOOLS = [
  "get_repository_snapshot",
  "read_repository_file",
  "read_pull_request_feedback",
  "create_development_branch",
  "commit_safe_files",
  "open_pull_request",
];

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function isAuthorized(request: Request, token?: string): boolean {
  return Boolean(token) && request.headers.get("Authorization") === `Bearer ${token}`;
}

function githubHeaders(env: Env): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "XPAYPOINT-Autonomous-CTO",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
}

async function githubRequest<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://api.github.com/repos/${env.REPO_OWNER}/${env.REPO_NAME}${path}`, {
    ...init,
    headers: { ...githubHeaders(env), ...(init.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  return response.json() as Promise<T>;
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function assertSafeBranch(branch: string): void {
  if (!/^autopilot\/[a-z0-9][a-z0-9-]{2,60}$/.test(branch)) {
    throw new Error("Writes are allowed only on autopilot/<short-slug> branches.");
  }
}

function assertSafePath(path: string): void {
  if (path.includes("\\\\") || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Path traversal is not allowed.");
  }
  const normalized = path.replace(/^\.\//, "");
  const allowed =
    normalized === "README.md" ||
    normalized.startsWith("cto-agent/src/") ||
    normalized.startsWith("cto-agent/tests/") ||
    normalized.startsWith("hq/") ||
    normalized.startsWith("docs/") ||
    normalized.startsWith("governance/");
  const blocked =
    /(^|\/)(\.env|\.dev\.vars|secrets?)(\.|\/|$)/i.test(normalized) ||
    /(^|\/)(index|topup|profil|cek-pesanan|admin-vipayment)\.html$/i.test(normalized) ||
    /(^|\/)(supabase|database|migrations)(\/|$)/i.test(normalized) ||
    normalized.startsWith(".github/workflows/") ||
    normalized === "cto-agent/wrangler.jsonc" ||
    normalized === "cto-agent/package.json" ||
    normalized === "cto-agent/tsconfig.json";
  if (!allowed || blocked) {
    throw new Error(`Protected or unsupported path: ${normalized}`);
  }
}

async function createMcpServer(env: Env): Promise<McpServer> {
  const server = new McpServer({ name: "xpaypoint-level2-github", version: "1.0.0" });

  server.registerTool(
    "get_repository_snapshot",
    {
      description: "Read XPAYPOINT main repository metadata, open PR summaries, and latest GitHub Actions runs. Read-only.",
      inputSchema: z.object({}),
    },
    async () => {
      const [pulls, runs, repo] = await Promise.all([
        githubRequest<any[]>(env, "/pulls?state=open&per_page=20"),
        githubRequest<any>(env, "/actions/runs?per_page=10"),
        githubRequest<any>(env, ""),
      ]);
      const result = {
        repository: repo.full_name,
        defaultBranch: repo.default_branch,
        openPullRequests: pulls.map((pr) => ({
          number: pr.number,
          title: pr.title,
          head: pr.head?.ref,
          headSha: pr.head?.sha,
          base: pr.base?.ref,
          reviewComments: pr.review_comments,
          comments: pr.comments,
          updatedAt: pr.updated_at,
          url: pr.html_url,
        })),
        workflowRuns: (runs.workflow_runs ?? []).map((run: any) => ({
          id: run.id,
          name: run.name,
          branch: run.head_branch,
          status: run.status,
          conclusion: run.conclusion,
          updatedAt: run.updated_at,
          url: run.html_url,
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "read_repository_file",
    {
      description: "Read a repository file from main or a named development branch. Never returns secrets from runtime bindings.",
      inputSchema: z.object({
        path: z.string().min(1).max(240),
        ref: z.string().default("main"),
      }),
    },
    async ({ path, ref }) => {
      if (ref !== "main" && !/^autopilot\/[a-z0-9][a-z0-9-]{2,60}$/.test(ref) && !/^feature\/[a-z0-9-]+$/.test(ref)) {
        throw new Error("Unsupported repository ref.");
      }
      const file = await githubRequest<any>(env, `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
      if (file.type !== "file" || typeof file.content !== "string") throw new Error("Path is not a text file.");
      const content = file.encoding === "base64" ? decodeBase64Utf8(file.content) : file.content;
      return { content: [{ type: "text", text: JSON.stringify({ path, ref, sha: file.sha, content }) }] };
    },
  );

  server.registerTool(
    "read_pull_request_feedback",
    {
      description: "Read review comments and submitted reviews for an open XPAYPOINT pull request. Read-only.",
      inputSchema: z.object({ number: z.number().int().positive() }),
    },
    async ({ number }) => {
      const [comments, reviews] = await Promise.all([
        githubRequest<any[]>(env, `/pulls/${number}/comments?per_page=100`),
        githubRequest<any[]>(env, `/pulls/${number}/reviews?per_page=100`),
      ]);
      const result = {
        comments: comments.map((item) => ({
          path: item.path,
          line: item.line,
          body: item.body,
          author: item.user?.login,
          createdAt: item.created_at,
        })),
        reviews: reviews.map((item) => ({
          state: item.state,
          body: item.body,
          author: item.user?.login,
          submittedAt: item.submitted_at,
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "create_development_branch",
    {
      description: "Create an isolated autopilot/<short-slug> branch from main. Cannot create or update main or production branches.",
      inputSchema: z.object({ name: z.string().min(5).max(80) }),
    },
    async ({ name }) => {
      assertSafeBranch(name);
      const mainRef = await githubRequest<any>(env, "/git/ref/heads/main");
      const created = await githubRequest<any>(env, "/git/refs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: `refs/heads/${name}`, sha: mainRef.object.sha }),
      });
      return { content: [{ type: "text", text: JSON.stringify({ branch: created.ref, sha: created.object?.sha }) }] };
    },
  );

  server.registerTool(
    "commit_safe_files",
    {
      description: "Create or update text files on an autopilot development branch only. Server-side path restrictions block store, payment, wallet, database, secret, and deployment files.",
      inputSchema: z.object({
        branch: z.string(),
        message: z.string().min(5).max(160),
        files: z.array(z.object({ path: z.string().min(1).max(240), content: z.string().max(200000) })).min(1).max(8),
      }),
    },
    async ({ branch, message, files }) => {
      assertSafeBranch(branch);
      for (const file of files) assertSafePath(file.path);
      if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured; repository writes are disabled.");
      const commits: Array<{ path: string; sha: string }> = [];
      for (const file of files) {
        const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
        let currentSha: string | undefined;
        try {
          const existing = await githubRequest<any>(env, `/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`);
          currentSha = existing.sha;
        } catch (error) {
          if (!String(error).includes("404")) throw error;
        }
        const result = await githubRequest<any>(env, `/contents/${encodedPath}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            content: encodeBase64Utf8(file.content),
            branch,
            ...(currentSha ? { sha: currentSha } : {}),
          }),
        });
        commits.push({ path: file.path, sha: result.commit?.sha ?? "" });
      }
      return { content: [{ type: "text", text: JSON.stringify({ branch, commits }) }] };
    },
  );

  server.registerTool(
    "open_pull_request",
    {
      description: "Open a pull request from an autopilot development branch into main for Founder review. This tool cannot merge or deploy.",
      inputSchema: z.object({
        head: z.string(),
        title: z.string().min(5).max(120),
        body: z.string().min(20).max(10000),
      }),
    },
    async ({ head, title, body }) => {
      assertSafeBranch(head);
      if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured; pull request creation is disabled.");
      const pr = await githubRequest<any>(env, "/pulls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          head,
          base: "main",
          body: `${body}\n\n---\n**Autopilot safety:** development branch only; not merged or deployed. Founder review is required.`,
          maintainer_can_modify: false,
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify({ number: pr.number, url: pr.html_url, state: pr.state, merged: pr.merged }) }] };
    },
  );

  return server;
}

function makeMcpHandler(env: Env, authInfo: { token: string; clientId: string; scopes: string[] }) {
  return createMcpHandler(() => createMcpServer(env), {
    route: "/mcp",
    responseMode: "json",
    authContext: { props: { clientId: authInfo.clientId, role: "level2" } },
  });
}

export class XPayPointCTOAgent extends Agent<Env, CTOState> {
  initialState = initialState;

  async onStart(): Promise<void> {
    await this.scheduleEvery(300, "runCycle", {}, {
      retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 15000 },
    });
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.setState({
      ...this.state,
      mcpServerUrl: `${url.origin}/mcp`,
    });
    await this.runCycle();
    return json({
      service: "XPAYPOINT Autonomous CTO",
      mode: "Level 2",
      intervalSeconds: 300,
      state: this.state,
    });
  }

  async runCycle(): Promise<void> {
    const checkedAt = new Date().toISOString();
    try {
      const siteResponse = await fetch(this.env.SITE_URL, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      const siteHealthy = siteResponse.ok;

      const [pulls, runs] = await Promise.all([
        githubRequest<any[]>(this.env, "/pulls?state=open&per_page=20"),
        githubRequest<any>(this.env, "/actions/runs?per_page=5"),
      ]);
      const latestRun = runs.workflow_runs?.[0];
      const reviewPRs = pulls.filter((pr) => Number(pr.review_comments ?? 0) > 0);
      const failedRun = latestRun?.conclusion === "failure";
      const alert = !siteHealthy || failedRun || reviewPRs.length > 0;
      const signature = alert
        ? JSON.stringify({
            siteHealthy,
            failedRun: latestRun?.id ?? null,
            reviewPRs: reviewPRs.map((pr) => [pr.number, pr.updated_at, pr.review_comments]),
          })
        : null;

      const nextState: CTOState = {
        ...this.state,
        lastCheckAt: checkedAt,
        siteStatus: siteHealthy ? "healthy" : "unhealthy",
        latestWorkflow: latestRun ? `${latestRun.name ?? "workflow"}: ${latestRun.status}/${latestRun.conclusion ?? "pending"}` : "no workflow runs found",
        openPullRequests: pulls.length,
        lastError: null,
      };

      if (signature && signature !== this.state.lastAlertSignature) {
        if (
          this.env.AUTOPILOT_ENABLED === "true" &&
          this.env.OPENAI_API_KEY &&
          this.env.GITHUB_TOKEN &&
          this.env.MCP_AUTH_TOKEN &&
          this.state.mcpServerUrl
        ) {
          const session = await this.startCodingSession({
            siteHealthy,
            latestRun,
            reviewPRs: reviewPRs.map((pr) => ({
              number: pr.number,
              title: pr.title,
              head: pr.head?.ref,
              reviewComments: pr.review_comments,
              url: pr.html_url,
            })),
          });
          nextState.lastSessionId = session.id;
          nextState.lastSessionAt = checkedAt;
        } else {
          nextState.lastError = "Autopilot belum diaktifkan atau kredensial runtime belum lengkap.";
        }
      }

      if (nextState.lastSessionId !== this.state.lastSessionId) {
        nextState.lastAlertSignature = signature;
      } else if (!signature) {
        nextState.lastAlertSignature = null;
      }
      this.setState(nextState);
    } catch (error) {
      this.setState({
        ...this.state,
        lastCheckAt: checkedAt,
        lastError: error instanceof Error ? error.message.slice(0, 500) : "Unknown monitoring error",
      });
    }
  }

  private async startCodingSession(context: {
    siteHealthy: boolean;
    latestRun: any;
    reviewPRs: Array<{ number: number; title: string; head: string; reviewComments: number; url: string }>;
  }): Promise<{ id: string }> {
    const response = await fetch("https://api.openai.com/v1/agents/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "agents=v1",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agent: {
          model: this.env.OPENAI_AGENT_MODEL || "gpt-6-astra",
          instructions: CTO_INSTRUCTIONS,
          tools: [{
            type: "mcp",
            server_label: "xpaypoint_level2",
            transport: {
              type: "http",
              server_url: this.state.mcpServerUrl,
              authorization: `Bearer ${this.env.MCP_AUTH_TOKEN}`,
            },
            connection_origin: "service",
            required: true,
            allowed_tools: ALLOWED_MCP_TOOLS,
          }],
        },
        environment: { type: "openai_hosted" },
        input: [
          "Investigate the following XPAYPOINT monitoring findings.",
          JSON.stringify(context),
          "Read relevant review feedback and repository files. If a safe fix is appropriate, create an autopilot/* branch, commit only permitted files, run tests in your sandbox when possible, and open a PR to main. If the problem involves protected payment, wallet, database, credential, or deployment areas, do not edit it; report that Founder approval is required.",
          "Do not merge or deploy.",
        ].join("\n\n"),
        stream: false,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`OpenAI Agents API ${response.status}: ${detail}`);
    }
    const result = await response.json() as any;
    const id = result.session_id ?? result.id;
    if (!id || typeof id !== "string") throw new Error("OpenAI Agents API did not return a session ID.");
    return { id };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "xpaypoint-cto-agent-dev", time: new Date().toISOString() });
    }

    if (url.pathname === "/mcp") {
      if (!isAuthorized(request, env.MCP_AUTH_TOKEN)) return new Response("Unauthorized", { status: 401 });
      if (!env.GITHUB_TOKEN) return json({ error: "GitHub integration is not configured." }, 503);
      const handler = makeMcpHandler(env, {
        token: env.MCP_AUTH_TOKEN!,
        clientId: "openai-agents-api",
        scopes: ["repository:read", "development:write", "pull_request:create"],
      });
      return handler(request, env, ctx);
    }

    if (url.pathname === "/start" && request.method === "POST") {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) return new Response("Unauthorized", { status: 401 });
      const agentRequest = new Request(new URL("/agents/xpaypointctoagent/founder", url.origin), {
        method: "GET",
        headers: request.headers,
      });
      return (await routeAgentRequest(agentRequest, env)) ?? new Response("Agent route not found", { status: 404 });
    }

    if (url.pathname.startsWith("/agents/")) {
      if (!isAuthorized(request, env.ADMIN_TOKEN)) return new Response("Unauthorized", { status: 401 });
      return (await routeAgentRequest(request, env)) ?? new Response("Agent route not found", { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
