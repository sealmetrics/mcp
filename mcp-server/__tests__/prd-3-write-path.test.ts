/**
 * Fase 3 Bloque 2 — MCP write-path. Relaxed gate, setup tools, dynamic read-only
 * enablement, secret hygiene. Covers TEST-3201..3206 and TEST-3601.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { buildServer } from "../src/server.js";
import type { SetupToolDef } from "../src/tools/setup.js";

const BASE_URL = "http://localhost:9998/api/v1";
const PROVISION_KEY = "pk_mcp_test";

let provisionStatus = 200;
let pixelInstalledAfter = 1; // number of polls before installed=true
let pixelPollCount = 0;

const PROVISION_OK = {
  success: true,
  data: {
    success: true,
    account_id: "acc-9",
    snippet: '<script src="https://t.sealmetrics.com/t.js?id=acc-9"></script>',
    api_key: "sm_SUPER_SECRET_KEY",
    dashboard_url: "https://my.sealmetrics.com/acc-9",
    claim_url: "https://my.sealmetrics.com/claim?token=MAGIC_LINK_SECRET",
    free_quota: { events_total: 1_000_000 },
    next_steps: ["place the snippet"],
  },
};

const handlers = [
  http.post(`${BASE_URL}/provision`, () => {
    if (provisionStatus === 200) return HttpResponse.json(PROVISION_OK);
    return HttpResponse.json({ detail: "nope" }, { status: provisionStatus });
  }),
  http.get(`${BASE_URL}/sites/:id/pixel/status`, ({ params }) => {
    pixelPollCount += 1;
    const installed = pixelPollCount >= pixelInstalledAfter;
    return HttpResponse.json({
      data: {
        account_id: params.id,
        installed,
        first_hit_at: null,
        last_hit_at: installed ? "2026-06-27T10:00:00Z" : null,
        total_hits: installed ? 4 : 0,
      },
    });
  }),
];

const mockServer = setupServer(...handlers);
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mockServer.resetHandlers();
  provisionStatus = 200;
  pixelInstalledAfter = 1;
  pixelPollCount = 0;
});
afterAll(() => mockServer.close());

function build(apiKey?: string) {
  return buildServer({
    apiKey,
    baseUrl: BASE_URL,
    provisionKey: PROVISION_KEY,
    version: "test",
    pollDefaults: { intervalMs: 5, timeoutMs: 2000 },
  });
}

function tool(tools: SetupToolDef[], name: string): SetupToolDef {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`setup tool ${name} not found`);
  return t;
}

const SETUP_NAMES = [
  "provision_site",
  "verify_setup",
  "get_setup_status",
  "detect_framework",
  "get_instrumentation_guide",
  "verify_event_instrumented",
  "plan_install",
  "simulate_install",
];

describe("TEST-3201: starts WITHOUT api_key → only setup tools exposed", () => {
  it("read-only tools are all disabled; setup tools present + enabled", () => {
    const { readOnlyHandles, setupTools } = build(undefined);
    expect(readOnlyHandles.length).toBeGreaterThanOrEqual(40);
    expect(readOnlyHandles.every((h) => h.enabled === false)).toBe(true);
    expect(setupTools.map((t) => t.name).sort()).toEqual([...SETUP_NAMES].sort());
  });

  it("provision_site and simulate_install are the only non-read-only setup tools (RF-3206)", () => {
    const { setupTools } = build(undefined);
    const writeTools = setupTools.filter((t) => t.annotations.readOnlyHint === false).map((t) => t.name);
    // provision_site writes through the API; simulate_install writes nothing but RUNS
    // agent-written JS locally and can drive a browser, so neither may be declared
    // read-only: that hint is what lets a client skip asking the user.
    expect(writeTools.sort()).toEqual(["provision_site", "simulate_install"]);
  });
});

describe("TEST-3202: starts WITH api_key → setup + read-only enabled (v1.2.0 parity)", () => {
  it("read-only tools all enabled", () => {
    const { readOnlyHandles, setupTools } = build("sm_existing_key");
    expect(readOnlyHandles.every((h) => h.enabled === true)).toBe(true);
    expect(setupTools.length).toBe(SETUP_NAMES.length);
  });
});

describe("TEST-3203 / TEST-3205: provision_site response hygiene + status mapping", () => {
  it("200 → returns account_id/snippet/dashboard_url, never the api_key or claim token", async () => {
    const { setupTools } = build(undefined);
    const result = await tool(setupTools, "provision_site").handler({
      site_name: "My Shop",
      email: "owner@example.com",
      accept_terms: true,
    });
    const json = JSON.stringify(result);
    expect((result as { account_id: string }).account_id).toBe("acc-9");
    expect(json).toContain("snippet");
    expect((result as { dashboard_url: string }).dashboard_url).toContain("acc-9");
    expect((result as { claim_email_sent_to: string }).claim_email_sent_to).toBe("owner@example.com");
    // VAL-3201: api_key never surfaced. VAL-3203/RF-3207: claim magic-link never surfaced.
    expect(json).not.toContain("sm_SUPER_SECRET_KEY");
    expect(json).not.toContain("MAGIC_LINK_SECRET");
    expect(json).not.toContain("token=");
  });

  it("401 → AUTH_REQUIRED error, no account", async () => {
    provisionStatus = 401;
    const { setupTools } = build(undefined);
    await expect(
      tool(setupTools, "provision_site").handler({ site_name: "S", email: "a@b.com", accept_terms: true }),
    ).rejects.toThrow(/AUTH_REQUIRED/);
  });

  it("503 → kill-switch error (PROVISIONING_DISABLED)", async () => {
    provisionStatus = 503;
    const { setupTools } = build(undefined);
    await expect(
      tool(setupTools, "provision_site").handler({ site_name: "S", email: "a@b.com", accept_terms: true }),
    ).rejects.toThrow(/PROVISIONING_DISABLED/);
  });

  it("missing accept_terms → refuses to provision", async () => {
    const { setupTools } = build(undefined);
    await expect(
      tool(setupTools, "provision_site").handler({ site_name: "S", email: "a@b.com" }),
    ).rejects.toThrow(/accept_terms/);
  });
});

describe("TEST-3204: verify_setup polls false→true", () => {
  it("confirms installed", async () => {
    pixelInstalledAfter = 2;
    const { setupTools } = build("sm_existing_key");
    const res = (await tool(setupTools, "verify_setup").handler({ account_id: "acc-9" })) as {
      installed: boolean;
      total_hits: number;
    };
    expect(res.installed).toBe(true);
    expect(res.total_hits).toBe(4);
  });
});

describe("TEST-3206: provision_site enables read-only tools in the same session", () => {
  it("read-only tools flip from disabled to enabled, api_key not leaked", async () => {
    const built = build(undefined);
    expect(built.readOnlyHandles.every((h) => h.enabled === false)).toBe(true);

    const result = await tool(built.setupTools, "provision_site").handler({
      site_name: "My Shop",
      email: "owner@example.com",
      accept_terms: true,
    });

    // RF-3202b: the ~47 read-only tools are now enabled (tools/list_changed effect).
    expect(built.readOnlyHandles.every((h) => h.enabled === true)).toBe(true);
    // The adopted key works for read-only requests now.
    expect(built.client.hasApiKey()).toBe(true);
    // VAL-3201: still not echoed.
    expect(JSON.stringify(result)).not.toContain("sm_SUPER_SECRET_KEY");
  });
});

describe("TEST-3601: revoked mcp-channel provision key → AUTH_REQUIRED, no account", () => {
  it("401 from /provision surfaces AUTH_REQUIRED and does not provision", async () => {
    provisionStatus = 401;
    const { setupTools, setupContext } = build(undefined);
    await expect(
      tool(setupTools, "provision_site").handler({ site_name: "S", email: "a@b.com", accept_terms: true }),
    ).rejects.toThrow(/AUTH_REQUIRED/);
    expect(setupContext.state.provisioned).toBe(false);
  });
});

describe("read-only tools fail clearly without a key (defense in depth, RF-3602)", () => {
  it("invoking a read-only handler with no key throws AUTH_REQUIRED", async () => {
    const { client } = build(undefined);
    await expect(client.request("/stats/overview", { site_id: "x" })).rejects.toThrow(/AUTH_REQUIRED/);
  });
});

describe("get_setup_status + get_instrumentation_guide", () => {
  it("status reflects provisioning; guide substitutes the account id and never writes code", async () => {
    const built = build(undefined);
    let status = (await tool(built.setupTools, "get_setup_status").handler({})) as { provisioned: boolean };
    expect(status.provisioned).toBe(false);

    await tool(built.setupTools, "provision_site").handler({
      site_name: "S",
      email: "a@b.com",
      accept_terms: true,
    });
    status = (await tool(built.setupTools, "get_setup_status").handler({})) as { provisioned: boolean };
    expect(status.provisioned).toBe(true);

    const guide = (await tool(built.setupTools, "get_instrumentation_guide").handler({})) as {
      account_id: string;
      guide: string;
    };
    expect(guide.account_id).toBe("acc-9");
    expect(guide.guide).toContain("acc-9");
    expect(guide.guide).toContain("does **not** write these calls for you");
  });
});
