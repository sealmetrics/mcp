/**
 * PRD-058 D — plan_install and simulate_install over the MCP setup tools. The rules
 * and the simulator are tested in setup-core; this covers the tool layer: argument
 * handling, site domains fetched with the api key (and not guessed without one),
 * the stale-plan refusal, and the compact payload.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { buildServer } from "../src/server.js";
import type { SetupToolDef } from "../src/tools/setup.js";

const BASE_URL = "http://localhost:9996/api/v1";
let sitesCalls = 0;

const mockServer = setupServer(
  http.get(`${BASE_URL}/sites`, () => {
    sitesCalls++;
    return HttpResponse.json({
      success: true,
      data: { sites: [{ id: "acct_demo", name: "Demo", domains: ["demo-store.com"], timezone: "Europe/Madrid" }], total: 1 },
    });
  }),
);
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mockServer.resetHandlers();
  sitesCalls = 0;
});
afterAll(() => mockServer.close());

function tool(name: string, apiKey: string | null = "sm_existing_key"): SetupToolDef {
  const { setupTools } = buildServer({ apiKey: apiKey ?? undefined, baseUrl: BASE_URL, provisionKey: "pk_mcp_test", version: "test" });
  const t = setupTools.find((x) => x.name === name);
  if (!t) throw new Error(`${name} not found`);
  return t;
}

const plan = () => ({
  account_id: "acct_demo",
  vertical: "leadgen",
  site: { domain: "demo-store.com" },
  loader: { file: "index.html", snippet_url: "https://t.sealmetrics.com/t.js?id=acct_demo" },
  events: [
    {
      kind: "conv",
      name: "lead",
      trigger: { type: "submit", where: "#contact-form" },
      properties: { form_name: { type: "string", example: "contact" } },
    },
  ],
});

describe("plan_install tool", () => {
  it("is read-only, local, and validates with the site's domains", async () => {
    const t = tool("plan_install");
    expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    // simulate_install executes agent-written JS and can drive a browser: it must NOT be
    // declared read-only, or a client auto-approves it.
    expect(tool("simulate_install").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const r = (await t.handler(plan())) as { status: string; plan_id: string; checked: { site_domains: boolean } };
    expect(r.status).toBe("ok");
    expect(r.plan_id).toMatch(/^[0-9a-f]{12}$/);
    expect(r.checked.site_domains).toBe(true);
    expect(sitesCalls).toBe(1);
  });

  it("blocks a domain the site does not list", async () => {
    const r = (await tool("plan_install").handler({ ...plan(), site: { domain: "staging.other.com" } })) as {
      status: string;
      findings: { code: string }[];
    };
    expect(r.status).toBe("blocked");
    expect(r.findings.map((f) => f.code)).toContain("PL-11");
  });

  it("without an api key it does not guess the domains", async () => {
    const r = (await tool("plan_install", null).handler(plan())) as { checked: { site_domains: boolean }; findings: { code: string; severity: string }[] };
    expect(sitesCalls).toBe(0);
    expect(r.checked.site_domains).toBe(false);
    expect(r.findings.find((f) => f.code === "PL-11")?.severity).toBe("info");
  });

  it("asks for the snippet URL instead of inventing one", async () => {
    const p = plan() as Record<string, unknown>;
    p.loader = { file: "index.html" };
    await expect(tool("plan_install").handler(p)).rejects.toThrow(/snippet_url/);
  });

  it("accepts the plan wrapped in { plan } as well", async () => {
    const r = (await tool("plan_install").handler({ plan: plan() })) as { status: string };
    expect(r.status).toBe("ok");
  });
});

describe("simulate_install tool", () => {
  it("simulates the approved plan and drops the simulator constants from payloads", async () => {
    const { plan_id } = (await tool("plan_install").handler(plan())) as { plan_id: string };
    const r = (await tool("simulate_install").handler({
      plan: plan(),
      plan_id,
      cases: [{ event: "lead", code: "sealmetrics.conv('lead', 0, { form_name: form.name })", vars: { form: { name: "contact" } } }],
    })) as { status: string; verdict: string; wording: string; cases: { hits: { payload: Record<string, unknown> }[] }[] };
    expect(r.status).toBe("ok");
    expect(r.verdict).toBe("pass");
    expect(r.wording).toMatch(/not verified/);
    const payload = r.cases[0].hits[0].payload;
    expect(payload).toMatchObject({ e: "lead", x: { form_name: "contact" } });
    for (const k of ["a", "s", "t", "z", "c"]) expect(payload).not.toHaveProperty(k);
  });

  it("refuses a plan edited after approval", async () => {
    const { plan_id } = (await tool("plan_install").handler(plan())) as { plan_id: string };
    const edited = plan();
    edited.events[0].properties.form_name.example = "quote";
    const r = (await tool("simulate_install").handler({ plan: edited, plan_id })) as { status: string; simulation_id: null };
    expect(r.status).toBe("stale_plan");
    expect(r.simulation_id).toBeNull();
  });

  it("level 'page' needs a base_url, and refuses a remote one without allow_remote_url", async () => {
    const { plan_id } = (await tool("plan_install").handler(plan())) as { plan_id: string };
    await expect(tool("simulate_install").handler({ plan: plan(), plan_id, level: "page", flows: [] })).rejects.toThrow(/base_url/);
    const r = (await tool("simulate_install").handler({
      plan: plan(),
      plan_id,
      level: "page",
      base_url: "https://demo-store.com",
      flows: [{ event: "lead", steps: [{ goto: "/" }] }],
    })) as { status: string; level: string; message: string };
    expect(r).toMatchObject({ status: "invalid_input", level: "page" });
    expect(r.message).toMatch(/allow_remote_url/);
  });

  it("requires a plan_id", async () => {
    await expect(tool("simulate_install").handler({ plan: plan() })).rejects.toThrow(/plan_id/);
  });
});
