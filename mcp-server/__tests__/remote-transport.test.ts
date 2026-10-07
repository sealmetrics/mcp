/**
 * PRD mcp-remote-oauth — mcp-server side tests.
 *
 * - TEST-RMT01: auth middleware — no token → 401 + WWW-Authenticate pointing at
 *   the protected-resource metadata; invalid/expired/revoked (inactive) token →
 *   401; valid token → the request reaches the MCP server with the resolved
 *   api_key; introspection outage → 503.
 * - TEST-RMT04: tool parity stdio vs HTTP for the covered tools (same names,
 *   same input schemas).
 * - TEST-RMT05: the remote transport lists neither the setup/write tools
 *   (VAL-RMT11) nor the tools uncovered by api_key scopes (RF-RMT25), and adds
 *   the ChatGPT-compat `search`/`fetch` (B6).
 * - VAL-RMT10: Host/Origin validation (DNS-rebinding protection).
 * - RF-RMT12: /.well-known/oauth-protected-resource (RFC 9728).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRemoteApp } from "../src/remote/app.js";
import { REMOTE_EXCLUDED_TOOLS } from "../src/remote/gate.js";
import { Metrics } from "../src/remote/metrics.js";
import { IntrospectionError, type IntrospectionResult } from "../src/remote/introspect.js";
import { detectPeriod } from "../src/remote/openai-tools.js";
import { buildServer } from "../src/server.js";
import { ALL_TOOLS, type ToolDef } from "../src/tools/index.js";
import type { SealMetricsClient } from "../src/client.js";

const VALID_TOKEN = "smat_valid_token";
// PRD-043: a grant covering several sites (introspection returns no account_id).
const MULTI_TOKEN = "smat_multi_token";
const ALL_SITES_TOKEN = "smat_all_sites_token";
const REVOKED_TOKEN = "smat_revoked_token";
const OUTAGE_TOKEN = "smat_outage_token";
const API_KEY = "sm_resolved_key";
const ACCOUNT_ID = "test-account";
const OTHER_ACCOUNT_ID = "other-account";

let server: Server;
let baseUrl: string;
let host: string;
// Swapped in by the default-site-injection suite (real API stub).
let stubApiBaseUrl: string | undefined;

function fakeIntrospect(token: string): Promise<IntrospectionResult> {
  if (token === VALID_TOKEN) {
    return Promise.resolve({
      active: true,
      account_id: ACCOUNT_ID,
      account_ids: [ACCOUNT_ID],
      all_sites: false,
      site_count: 1,
      scopes: ["analytics:read"],
      api_key: API_KEY,
    });
  }
  if (token === MULTI_TOKEN) {
    // No account_id: the model must name the site (DEC-04).
    return Promise.resolve({
      active: true,
      account_ids: [ACCOUNT_ID, OTHER_ACCOUNT_ID],
      all_sites: false,
      site_count: 2,
      scopes: ["analytics:read"],
      api_key: API_KEY,
    });
  }
  if (token === ALL_SITES_TOKEN) {
    return Promise.resolve({
      active: true,
      account_ids: [],
      all_sites: true,
      site_count: 4,
      scopes: ["analytics:read"],
      api_key: API_KEY,
    });
  }
  if (token === OUTAGE_TOKEN) {
    return Promise.reject(new IntrospectionError("unreachable", true));
  }
  return Promise.resolve({ active: false });
}

beforeAll(async () => {
  const metrics = new Metrics();
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      // The app validates Host against the allowlist; tests connect to
      // 127.0.0.1:<port>, added below once the port is known.
      void appHolder.app?.(req, res);
    });
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  host = `127.0.0.1:${port}`;
  baseUrl = `http://${host}`;

  appHolder.app = createRemoteApp(
    {
      publicUrl: baseUrl,
      oauthIssuer: "https://my.sealmetrics.example",
      get apiBaseUrl() {
        return stubApiBaseUrl ?? "http://localhost:9999/api/v1";
      },
      dashboardUrl: "https://my.sealmetrics.example",
      version: "0.0.0-test",
      maxBodyBytes: 1024 * 64,
      allowedHosts: new Set([host]),
      allowedOrigins: new Set(["https://claude.ai"]),
      trustProxy: false,
    },
    {
      introspect: fakeIntrospect,
      rateLimiter: { check: async () => ({ allowed: true, retryAfter: 0 }) },
      metrics,
      log: () => {},
    },
  );
});

const appHolder: { app?: ReturnType<typeof createRemoteApp> } = {};

afterAll(() => {
  server.close();
});

function mcpRequest(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

const TOOLS_LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

type RemoteTool = {
  name: string;
  description?: string;
  annotations?: { readOnlyHint?: boolean; openWorldHint?: boolean; destructiveHint?: boolean };
  inputSchema?: {
    required?: string[];
    properties?: Record<string, { description?: string }>;
  };
};

async function listRemoteToolsFull(): Promise<RemoteTool[]> {
  const response = await mcpRequest(TOOLS_LIST, {
    Authorization: `Bearer ${VALID_TOKEN}`,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { result: { tools: RemoteTool[] } };
  return body.result.tools;
}

async function listRemoteTools(): Promise<string[]> {
  const response = await mcpRequest(TOOLS_LIST, {
    Authorization: `Bearer ${VALID_TOKEN}`,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { tools: Array<{ name: string }> };
  };
  return body.result.tools.map((tool) => tool.name);
}

describe("TEST-RMT01 — auth middleware", () => {
  it("no token → 401 with WWW-Authenticate pointing at resource metadata", async () => {
    const response = await mcpRequest(INITIALIZE);
    expect(response.status).toBe(401);
    const wwwAuth = response.headers.get("WWW-Authenticate") ?? "";
    expect(wwwAuth).toContain("Bearer");
    expect(wwwAuth).toContain(`resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("invalid/revoked token → 401", async () => {
    const response = await mcpRequest(INITIALIZE, {
      Authorization: `Bearer ${REVOKED_TOKEN}`,
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("invalid_token");
  });

  it("valid token → request served (initialize responds)", async () => {
    const response = await mcpRequest(INITIALIZE, {
      Authorization: `Bearer ${VALID_TOKEN}`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result?: { serverInfo?: { name: string } } };
    expect(body.result?.serverInfo?.name).toBe("sealmetrics");
  });

  it("introspection outage → 503 (not 401)", async () => {
    const response = await mcpRequest(INITIALIZE, {
      Authorization: `Bearer ${OUTAGE_TOKEN}`,
    });
    expect(response.status).toBe(503);
  });

  it("rejects oversized bodies with 413", async () => {
    const response = await mcpRequest(
      { ...INITIALIZE, params: { ...INITIALIZE.params, padding: "x".repeat(1024 * 128) } },
      { Authorization: `Bearer ${VALID_TOKEN}` },
    );
    expect(response.status).toBe(413);
  });
});

describe("VAL-RMT10 — Host/Origin validation", () => {
  it("rejects disallowed Origin with 403", async () => {
    const response = await mcpRequest(INITIALIZE, {
      Authorization: `Bearer ${VALID_TOKEN}`,
      Origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
  });

  it("accepts allowed Origin", async () => {
    const response = await mcpRequest(INITIALIZE, {
      Authorization: `Bearer ${VALID_TOKEN}`,
      Origin: "https://claude.ai",
    });
    expect(response.status).toBe(200);
  });

  it("rejects disallowed Host with 403", async () => {
    // undici's fetch silently drops Host overrides — use a raw http request.
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${baseUrl}/mcp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Authorization: `Bearer ${VALID_TOKEN}`,
            Host: "rebound.example",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(INITIALIZE));
    });
    expect(status).toBe(403);
  });
});

describe("RF-RMT12 — protected resource metadata (RFC 9728)", () => {
  it("serves /.well-known/oauth-protected-resource without auth", async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.resource).toBe(`${baseUrl}/mcp`);
    expect(body.authorization_servers).toEqual(["https://my.sealmetrics.example"]);
    expect(body.scopes_supported).toEqual(["analytics:read"]);
  });

  it("serves the path-scoped variant /mcp too", async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(200);
  });
});

describe("input schemas on the remote surface", () => {
  it("publishes required arguments over HTTP", async () => {
    const tools = await listRemoteToolsFull();
    const propertyValues = tools.find((tool) => tool.name === "get_property_values");
    expect(propertyValues?.inputSchema?.required).toEqual(["property_key"]);
  });

  it("describes site_id without the stdio-only env var as the way to omit it", async () => {
    const tools = await listRemoteToolsFull();
    const overview = tools.find((tool) => tool.name === "get_overview");
    expect(overview?.inputSchema?.properties?.site_id?.description).toMatch(/a site the connection covers/);
    expect(overview?.inputSchema?.properties?.site_id?.description).not.toMatch(/list_sites/);
  });
});

describe("tool annotations on the remote surface", () => {
  it("declares all three hints, because the protocol defaults are wrong here", async () => {
    const tools = await listRemoteToolsFull();
    expect(tools.length).toBeGreaterThan(0);

    for (const tool of tools) {
      // An undeclared openWorldHint means "open internet" and an undeclared
      // destructiveHint means "irreversible". Both are false for a tool that
      // reads one customer's own analytics, and both are read by the OpenAI
      // plugin review, which compares them against the listing.
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.openWorldHint).toBe(false);
      expect(tool.annotations?.destructiveHint).toBe(false);
    }
  });
});

describe("tool descriptions for the Claude directory", () => {
  // The Connectors Directory submission asks the publisher to confirm that
  // "tool descriptions contain no instructions about model behavior, other
  // tools, or external instruction sources". Which tool fits which question
  // belongs in the server instructions instead.
  //
  // "search" and "fetch" are also plain English words, so for those two only a
  // backticked mention counts as a reference.
  const DIRECTIVE =
    /\b(call|use) (this|it|them)\b|\bcall [a-z_]+ (first|directly)\b|\bprefer\b|\binstead\b(?! of)|\bfirst when\b|\bafter (reading|calling)\b|\*\*/i;

  function mentions(text: string, name: string): boolean {
    if (name === "search" || name === "fetch") return text.includes("`" + name + "`");
    return new RegExp(`\\b${name}\\b`).test(text);
  }

  it("no description or parameter description names another tool", async () => {
    const tools = await listRemoteToolsFull();
    const names = tools.map((tool) => tool.name);
    const offenders: string[] = [];
    for (const tool of tools) {
      const texts = [
        tool.description ?? "",
        ...Object.values(tool.inputSchema?.properties ?? {}).map((p) => p.description ?? ""),
      ];
      for (const other of names) {
        if (other !== tool.name && texts.some((text) => mentions(text, other))) {
          offenders.push(`${tool.name} → ${other}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no description tells the model what to do", async () => {
    const tools = await listRemoteToolsFull();
    const offenders = tools
      .filter((tool) => DIRECTIVE.test(tool.description ?? ""))
      .map((tool) => `${tool.name}: ${(tool.description ?? "").match(DIRECTIVE)?.[0]}`);
    expect(offenders).toEqual([]);
  });
});

describe("TEST-RMT05 — remote tool listing gates", () => {
  it("does not list setup/write tools nor scope-uncovered tools; adds search/fetch", async () => {
    const names = await listRemoteTools();

    // VAL-RMT11: no setup/write tools
    for (const setupTool of [
      "provision_site",
      "verify_setup",
      "get_setup_status",
      "detect_framework",
      "get_instrumentation_guide",
      "verify_event_instrumented",
      "plan_install",
      "simulate_install",
    ]) {
      expect(names, `setup tool ${setupTool} must not be listed remotely`).not.toContain(setupTool);
    }

    // RF-RMT25: no tools uncovered by modern api_key scopes
    for (const excluded of REMOTE_EXCLUDED_TOOLS) {
      expect(names, `${excluded} must not be listed remotely`).not.toContain(excluded);
    }

    // B6: ChatGPT-compat tools present
    expect(names).toContain("search");
    expect(names).toContain("fetch");

    // Covered tools present
    expect(names).toContain("get_overview");
    expect(names).toContain("list_sites");
    expect(names).toContain("get_top_channels");
  });
});

describe("TEST-RMT04 — stdio vs HTTP parity for covered tools", () => {
  it("covered tools keep the same names and input schemas in both transports", async () => {
    const remoteNames = new Set(await listRemoteTools());

    const stdioCovered = ALL_TOOLS.filter((tool) => !REMOTE_EXCLUDED_TOOLS.has(tool.name));
    for (const tool of stdioCovered) {
      expect(remoteNames.has(tool.name), `${tool.name} missing in remote transport`).toBe(true);
    }

    // Remote = covered stdio tools + search/fetch, nothing else.
    const expected = new Set([...stdioCovered.map((tool) => tool.name), "search", "fetch"]);
    expect([...remoteNames].sort()).toEqual([...expected].sort());
  });

  it("buildServer with the remote gates registers only enabled read-only tools", () => {
    const { readOnlyHandles, setupTools } = buildServer({
      apiKey: "sm_x",
      baseUrl: "http://localhost:9999/api/v1",
      provisionKey: "",
      version: "0.0.0",
      omitSetupTools: true,
      excludeReadOnlyTools: REMOTE_EXCLUDED_TOOLS,
    });
    expect(setupTools).toHaveLength(0);
    expect(readOnlyHandles.length).toBe(ALL_TOOLS.length - REMOTE_EXCLUDED_TOOLS.size);
  });
});

// Minimal API stub so tool handlers can complete a real HTTP round-trip.
// Shared by the default-site and the PRD-043 multi-site suites.
let apiStub: Server;
const capturedUrls: string[] = [];

async function startApiStub(): Promise<void> {
  await new Promise<void>((resolve) => {
    apiStub = createServer((req, res) => {
      capturedUrls.push(req.url ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: {}, sites: [] }));
    });
    apiStub.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = apiStub.address() as AddressInfo;
  stubApiBaseUrl = `http://127.0.0.1:${port}/api/v1`;
}

describe("remote transport — default site injection", () => {
  beforeAll(startApiStub);

  afterAll(() => {
    apiStub.close();
  });

  it("tool calls without site_id use the authorized site (one site per grant)", async () => {
    const response = await mcpRequest(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "get_overview", arguments: { period: "7d" } },
      },
      { Authorization: `Bearer ${VALID_TOKEN}` },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    // Without injection this errors with "site_id is required".
    expect(body.result.isError).toBeFalsy();
    const overviewCall = capturedUrls.find((u) => u.includes("/stats/overview"));
    expect(overviewCall).toContain(`site_id=${ACCOUNT_ID}`);
  });
});

describe("PRD-043 — multi-site connections", () => {
  beforeAll(startApiStub);

  afterAll(() => {
    apiStub.close();
  });

  async function callTool(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ isError?: boolean; content: Array<{ text: string }> }> {
    const response = await mcpRequest(
      { jsonrpc: "2.0", id: 42, method: "tools/call", params: { name, arguments: args } },
      { Authorization: `Bearer ${token}` },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    return body.result;
  }

  it("a multi-site grant authenticates (no account_id required)", async () => {
    const response = await mcpRequest(
      { ...INITIALIZE, id: 40 },
      { Authorization: `Bearer ${MULTI_TOKEN}` },
    );
    expect(response.status).toBe(200);
  });

  it("TEST-004: without site_id the guide message points at list_sites", async () => {
    const result = await callTool(MULTI_TOKEN, "get_overview", { period: "7d" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("site_id is required");
    expect(result.content[0].text).toContain("list_sites");
    // RF-005: the remote message must not mention the stdio env var.
    expect(result.content[0].text).not.toContain("SEALMETRICS_SITE_ID");
  });

  it("TEST-004: an explicit site_id is used verbatim", async () => {
    capturedUrls.length = 0;
    const result = await callTool(MULTI_TOKEN, "get_overview", {
      period: "7d",
      site_id: OTHER_ACCOUNT_ID,
    });
    expect(result.isError).toBeFalsy();
    const call = capturedUrls.find((u) => u.includes("/stats/overview"));
    expect(call).toContain(`site_id=${OTHER_ACCOUNT_ID}`);
  });

  it("an all-sites grant behaves like a multi-site one", async () => {
    const result = await callTool(ALL_SITES_TOKEN, "get_overview", { period: "7d" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("site_id is required");
  });

  it("RF-005: the remote server ships instructions telling the model to ask", async () => {
    const response = await mcpRequest(
      { ...INITIALIZE, id: 41 },
      { Authorization: `Bearer ${MULTI_TOKEN}` },
    );
    const body = (await response.json()) as { result: { instructions?: string } };
    expect(body.result.instructions).toContain("site_id");
    expect(body.result.instructions).toContain("list_sites");
    expect(body.result.instructions).toContain("ASK");
  });

  it("RF-006: search/fetch are registered for a multi-site grant too", async () => {
    const response = await mcpRequest(TOOLS_LIST, {
      Authorization: `Bearer ${MULTI_TOKEN}`,
    });
    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((tool) => tool.name);
    expect(names).toContain("search");
    expect(names).toContain("fetch");
  });

  it("RF-009: metrics count grants by shape, without account cardinality", () => {
    const metrics = new Metrics();
    metrics.recordGrantType("single");
    metrics.recordGrantType("multi");
    metrics.recordGrantType("multi");
    metrics.recordGrantType("all");
    const rendered = metrics.render();
    expect(rendered).toContain('mcp_remote_grant_types_total{type="single"} 1');
    expect(rendered).toContain('mcp_remote_grant_types_total{type="multi"} 2');
    expect(rendered).toContain('mcp_remote_grant_types_total{type="all"} 1');
    expect(rendered).not.toContain(ACCOUNT_ID);
  });
});

describe("B6 — search period detection", () => {
  it("maps natural-language ranges to valid API periods", () => {
    expect(detectPeriod("conversions last 7 days")).toBe("7d");
    expect(detectPeriod("traffic THIS MONTH")).toBe("this_month");
    expect(detectPeriod("overview")).toBe("30d");
    expect(detectPeriod("sales yesterday")).toBe("yesterday");
  });
});

// =============================================================================
// PRD-055 RF-A05 — the remote gate must not depend on anyone's memory.
//
// Every tool listed remotely is executed against a fake client that records
// the API path it hits; none may start with a router prefix gated by
// `require_scope("read")` — a scope a modern api_key can never carry. The
// prefixes are the ones verified in api/src/sealmetrics_api/routers/
// (segments.py, alerts.py, bot_stats.py, webhooks.py). `/channel-groups` left
// this list in PRD-055 Bloque A (its reads accept `sites:read`).
//
// `search`/`fetch` (openai-tools) are not covered here: they delegate to the
// same ToolDef handlers, so they cannot reach a route these tools do not.
// =============================================================================

describe("PRD-055 RF-A05 — remotely listed tools never hit a read-only-scope router", () => {
  const READ_SCOPE_ROUTER_PREFIXES = ["/segments", "/alerts", "/bot-stats", "/webhooks"];
  // Tools that never call the SealMetrics API (embedded content / public docs site).
  const NO_API_TOOLS = new Set([
    "get_marketing_playbook",
    "get_troubleshooting_guide",
    "search_docs",
    "get_doc",
  ]);

  function recordingClient(): { client: SealMetricsClient; paths: string[] } {
    const paths: string[] = [];
    const hit = (path: string) => {
      paths.push(path);
    };
    const client = {
      hasApiKey: () => true,
      getApiKey: () => "sm_fake",
      setApiKey: () => undefined,
      request: async (path: string) => {
        hit(path);
        return {};
      },
      requestDirect: async (path: string) => {
        hit(path);
        return {};
      },
      requestPaginated: async (path: string) => {
        hit(path);
        return { data: [], total: 0, page: 1, page_size: 0, has_next: false };
      },
      post: async (path: string) => {
        hit(path);
        return {};
      },
      patch: async (path: string) => {
        hit(path);
        return {};
      },
      del: async (path: string) => {
        hit(path);
      },
    } as unknown as SealMetricsClient;
    return { client, paths };
  }

  /** Minimal args satisfying the tool's `required` list (plus a site). */
  function minimalArgs(tool: ToolDef): Record<string, unknown> {
    const args: Record<string, unknown> = { site_id: ACCOUNT_ID };
    for (const key of tool.inputSchema.required ?? []) {
      const prop = tool.inputSchema.properties[key] as { type?: string; enum?: string[] };
      if (prop.enum?.length) args[key] = prop.enum[0];
      else if (prop.type === "number" || prop.type === "integer") args[key] = 1;
      else if (prop.type === "boolean") args[key] = false;
      else if (prop.type === "array") args[key] = [];
      else args[key] = "x";
    }
    return args;
  }

  async function routesHitBy(tool: ToolDef): Promise<string[]> {
    const { client, paths } = recordingClient();
    // The docs tools use global fetch against docs.sealmetrics.com — no network here.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("network disabled"))) as typeof fetch;
    try {
      await tool.handler(client, minimalArgs(tool));
    } catch {
      // The fake returns empty payloads; some handlers post-process them and
      // throw. The path was already recorded before that, which is all we need.
    } finally {
      globalThis.fetch = realFetch;
    }
    return paths;
  }

  function hitsReadScopeRouter(path: string): boolean {
    return READ_SCOPE_ROUTER_PREFIXES.some((prefix) => path.startsWith(prefix));
  }

  it("every remotely listed tool hits only routers an api_key can reach", async () => {
    const listed = ALL_TOOLS.filter((tool) => !REMOTE_EXCLUDED_TOOLS.has(tool.name));
    expect(listed.length).toBeGreaterThan(0);

    for (const tool of listed) {
      const paths = await routesHitBy(tool);
      if (NO_API_TOOLS.has(tool.name)) {
        expect(paths, `${tool.name} is expected to make no API call`).toEqual([]);
        continue;
      }
      expect(paths.length, `${tool.name} made no API call — add it to NO_API_TOOLS if intended`)
        .toBeGreaterThan(0);
      for (const path of paths) {
        expect(
          hitsReadScopeRouter(path),
          `${tool.name} hits ${path}, a router gated by require_scope("read") — exclude it in gate.ts`,
        ).toBe(false);
      }
    }
  });

  it("sanity: every excluded tool does hit a read-scope router (the recorder sees routes)", async () => {
    for (const name of REMOTE_EXCLUDED_TOOLS) {
      const tool = ALL_TOOLS.find((candidate) => candidate.name === name);
      expect(tool, `${name} is excluded but no longer exists in ALL_TOOLS`).toBeDefined();
      const paths = await routesHitBy(tool!);
      expect(
        paths.some(hitsReadScopeRouter),
        `${name} is excluded but hits ${paths.join(", ") || "nothing"} — reconsider the exclusion`,
      ).toBe(true);
    }
  });

  it("VAL-A06: the three channel-rules read tools are listed remotely", async () => {
    const names = await listRemoteTools();
    expect(names).toContain("test_channel_rules");
    expect(names).toContain("list_channel_rules");
    expect(names).toContain("get_channels");
  });
});
