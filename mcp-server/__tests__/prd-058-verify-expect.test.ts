/**
 * PRD-058 F4 — verify_event_instrumented with expectations: the row that arrived is
 * compared with what the install should send (explicit `expect`, or the simulation
 * of the same session), rows are matched by event name, and several recent rows
 * without an exact amount only verify "by recency".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { buildServer } from "../src/server.js";
import type { SetupToolDef } from "../src/tools/setup.js";

const BASE_URL = "http://localhost:9995/api/v1";
const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => {
  const v = clock;
  clock += 50;
  return v;
};

let rows: Array<Record<string, unknown>> = [];
const queries: Array<{ path: string; params: URLSearchParams }> = [];

const mockServer = setupServer(
  http.get(`${BASE_URL}/stats/conversions/raw`, ({ request }) => {
    const url = new URL(request.url);
    queries.push({ path: url.pathname, params: url.searchParams });
    return HttpResponse.json({ success: true, data: rows });
  }),
  http.get(`${BASE_URL}/stats/microconversions/raw`, ({ request }) => {
    const url = new URL(request.url);
    queries.push({ path: url.pathname, params: url.searchParams });
    return HttpResponse.json({ success: true, data: rows });
  }),
  http.get(`${BASE_URL}/sites`, () =>
    HttpResponse.json({
      success: true,
      data: { sites: [{ id: "acct_demo", name: "Demo", domains: ["demo-store.com"], timezone: "Europe/Madrid" }], total: 1 },
    }),
  ),
);
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mockServer.resetHandlers();
  rows = [];
  queries.length = 0;
  clock = T0;
});
afterAll(() => mockServer.close());

function tools() {
  const { setupTools } = buildServer({
    apiKey: "sm_existing_key",
    baseUrl: BASE_URL,
    provisionKey: "pk_mcp_test",
    version: "test",
    pollDefaults: { intervalMs: 5, timeoutMs: 1000 },
    now,
    sleep: () => Promise.resolve(),
  });
  const get = (name: string): SetupToolDef => {
    const t = setupTools.find((x) => x.name === name);
    if (!t) throw new Error(`${name} not found`);
    return t;
  };
  return { verify: get("verify_event_instrumented"), plan: get("plan_install"), simulate: get("simulate_install") };
}

const row = (extra: Record<string, unknown>) => ({
  conversion_type: "lead",
  amount: "0.00",
  properties: { form_name: "contact" },
  timestamp_utc: new Date(T0).toISOString(),
  ...extra,
});

interface VerifyResult {
  status: string;
  mismatches?: string[];
  simulation?: string;
  expectation?: Record<string, unknown>;
  recent_rows?: number;
  message: string;
}

describe("verify_event_instrumented: matching the right row", () => {
  it("queries micro rows with conversion_type and ignores rows of other events", async () => {
    rows = [row({ conversion_type: "add_to_cart" })];
    const r = (await tools().verify.handler({ account_id: "acct_demo", kind: "micro", name: "view_item" })) as VerifyResult;
    expect(r.status).toBe("pending");
    expect(queries[0].path).toMatch(/microconversions\/raw$/);
    expect(queries[0].params.get("conversion_type")).toBe("view_item");
    expect(queries[0].params.has("microconversion_type")).toBe(false);
  });

  it("several recent rows and no exact amount → verified_by_recency, not verified", async () => {
    rows = [row({}), row({ properties: { form_name: "newsletter" } })];
    const r = (await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead" })) as VerifyResult;
    expect(r.status).toBe("verified_by_recency");
    expect(r.recent_rows).toBe(2);
  });

  it("value_exact picks the test order among real purchases", async () => {
    rows = [
      row({ conversion_type: "purchase", amount: "89.00", properties: { currency: "EUR" } }),
      row({ conversion_type: "purchase", amount: "1.23", properties: { currency: "EUR" } }),
    ];
    const r = (await tools().verify.handler({
      account_id: "acct_demo",
      kind: "conv",
      name: "purchase",
      expect: { value_exact: 1.23, properties_required: ["currency"] },
    })) as VerifyResult;
    expect(r.status).toBe("verified");
  });

  it("value_exact with no row of that amount stays pending and says why", async () => {
    rows = [row({ conversion_type: "purchase", amount: "89.00" })];
    const r = (await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "purchase", expect: { value_exact: 1.23 } })) as VerifyResult;
    expect(r.status).toBe("pending");
    expect(r.message).toMatch(/none with amount 1.23/);
  });
});

describe("verify_event_instrumented: review fixes", () => {
  it("counts rows fired minutes before the call, within lookback_minutes", async () => {
    rows = [row({ timestamp_utc: new Date(T0 - 10 * 60_000).toISOString() })];
    expect(((await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead" })) as VerifyResult).status).toBe("verified");
    rows = [row({ timestamp_utc: new Date(T0 - 20 * 60_000).toISOString() })];
    expect(((await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead" })) as VerifyResult).status).toBe("pending");
    expect(((await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead", lookback_minutes: 30 })) as VerifyResult).status).toBe("verified");
  });

  it("rejects a capitalised taxonomy name instead of polling for it", async () => {
    const r = (await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "Purchase" })) as VerifyResult & { reason: string };
    expect(r).toMatchObject({ status: "rejected", reason: "not_lowercase" });
    expect(queries).toHaveLength(0);
  });

  it("accepts expect as a JSON string with numeric strings, and refuses bad or micro amounts", async () => {
    rows = [row({ conversion_type: "purchase", amount: "1.23" })];
    const r = (await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "purchase", expect: '{"value_exact":"1.23"}' })) as VerifyResult;
    expect(r.status).toBe("verified");
    await expect(tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "purchase", expect: { value_min: "lots" } })).rejects.toThrow(/must be a number/);
    await expect(tools().verify.handler({ account_id: "acct_demo", kind: "micro", name: "add_to_cart", expect: { value_min: 1 } })).rejects.toThrow(/conversions only/);
    await expect(tools().verify.handler({ account_id: "acct_demo", kind: "micro", name: "add_to_cart", expect: { properties: ["product_id"] } })).rejects.toThrow(/Unknown key in expect: properties/);
  });

  it("a real visitor's older-code row does not hide the test row that meets the expectation", async () => {
    rows = [row({ conversion_type: "purchase", amount: "0.00" }), row({ conversion_type: "purchase", amount: "20.00" })];
    const r = (await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "purchase", expect: { value_min: 0.01 } })) as VerifyResult;
    expect(r.status).toBe("verified_by_recency");
  });
});

describe("verify_event_instrumented: comparing with the expectation", () => {
  it("a purchase stored without revenue → mismatch that names the string-amount cause", async () => {
    rows = [row({ conversion_type: "purchase", amount: "0.00", properties: { currency: "EUR" } })];
    const r = (await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "purchase", expect: { value_min: 0.01 } })) as VerifyResult;
    expect(r.status).toBe("mismatch");
    expect(r.mismatches?.[0]).toMatch(/string instead of a number/);
  });

  it("PII nested in a JSON property is still flagged before anything else", async () => {
    rows = [row({ properties: { form_name: "contact", items: '[{"email":"a@b.com"}]' } })];
    const r = (await tools().verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead", expect: { properties_required: ["missing"] } })) as VerifyResult;
    expect(r.status).toBe("warning_pii");
  });

  it("derives the expectation from a simulation of this session", async () => {
    const t = tools();
    const plan = {
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
    };
    const { plan_id } = (await t.plan.handler(plan)) as { plan_id: string };
    const sim = (await t.simulate.handler({
      plan,
      plan_id,
      cases: [{ event: "lead", code: "sealmetrics.conv('lead', 0, { form_name: form.name })", vars: { form: { name: "contact" } } }],
    })) as { simulation_id: string; verdict: string };
    expect(sim.verdict).toBe("pass");

    rows = [row({ properties: { page: "/contact" } })];
    const mismatch = (await t.verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead", simulation_id: sim.simulation_id })) as VerifyResult;
    expect(mismatch).toMatchObject({ status: "mismatch", simulation: "found", expectation: { properties_required: ["form_name"] } });

    rows = [row({})];
    const ok = (await t.verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead", simulation_id: sim.simulation_id })) as VerifyResult;
    expect(ok.status).toBe("verified");

    queries.length = 0;
    const unknown = (await t.verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead", simulation_id: "nope" })) as VerifyResult;
    expect(unknown).toMatchObject({ status: "needs_expectation", simulation: "not_in_session" });
    expect(unknown.message).toMatch(/expect built from the approved plan/);
    expect(queries).toHaveLength(0);

    const withExpect = (await t.verify.handler({ account_id: "acct_demo", kind: "conv", name: "lead", simulation_id: "nope", expect: { properties_required: ["form_name"] } })) as VerifyResult;
    expect(withExpect).toMatchObject({ status: "verified", simulation: "not_in_session" });
    expect(withExpect.message).toMatch(/not in this session/);
  });
});
