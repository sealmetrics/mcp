/**
 * PRD-058 F5 (RF-1002) — a verification that times out says why: the verifiers read
 * GET /sites/{id}/pixel/rejections and return the cause instead of "no hits yet".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { buildServer } from "../src/server.js";
import type { SetupToolDef } from "../src/tools/setup.js";

const BASE_URL = "http://localhost:9994/api/v1";
let rejections: unknown = null;
let rejectionsStatus = 200;
const rejectionQueries: string[] = [];

const mockServer = setupServer(
  http.get(`${BASE_URL}/sites/:id/pixel/status`, ({ params }) =>
    HttpResponse.json({ success: true, data: { account_id: params.id, installed: false, first_hit_at: null, last_hit_at: null, total_hits: 0 } }),
  ),
  http.get(`${BASE_URL}/sites/:id/pixel/rejections`, ({ request }) => {
    rejectionQueries.push(new URL(request.url).search);
    return rejectionsStatus === 200 ? HttpResponse.json({ success: true, data: rejections }) : new HttpResponse("Not Found", { status: rejectionsStatus });
  }),
  http.get(`${BASE_URL}/stats/conversions/raw`, () => HttpResponse.json({ success: true, data: [] })),
  http.get(`${BASE_URL}/stats/microconversions/raw`, () => HttpResponse.json({ success: true, data: [] })),
);
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mockServer.resetHandlers();
  rejections = null;
  rejectionsStatus = 200;
  rejectionQueries.length = 0;
});
afterAll(() => mockServer.close());

function tool(name: string): SetupToolDef {
  let clock = 1_700_000_000_000;
  const { setupTools } = buildServer({
    apiKey: "sm_existing_key",
    baseUrl: BASE_URL,
    provisionKey: "pk_mcp_test",
    version: "test",
    pollDefaults: { intervalMs: 5, timeoutMs: 30 },
    now: () => (clock += 50),
    sleep: () => Promise.resolve(),
  });
  const t = setupTools.find((x) => x.name === name);
  if (!t) throw new Error(`${name} not found`);
  return t;
}

const localhostRejections = {
  account_id: "acct_demo",
  site_id: "acct_demo",
  window_minutes: 16,
  available: true,
  accepted: 0,
  rejected: 14,
  reasons: [{ reason: "invalid_domain", count: 14, origins: [{ origin: "http://localhost:3000", count: 14 }] }],
};

describe("verify_setup timeout explains rejected hits", () => {
  it("names invalid_domain from a local dev server", async () => {
    rejections = localhostRejections;
    const r = (await tool("verify_setup").handler({ account_id: "acct_demo" })) as {
      status: string;
      cause: string;
      rejections: { rejected: number };
      next_steps: string[];
    };
    expect(r.status).toBe("pending");
    expect(r.cause).toMatch(/No hit was stored .* 14 hits were rejected: .*invalid_domain from http:\/\/localhost:3000 — a local dev server/);
    expect(r.rejections.rejected).toBe(14);
    expect(r.next_steps[0]).toBe(r.cause);
    expect(rejectionQueries[0]).toBe("?minutes=16");
    expect(JSON.stringify(r)).not.toContain("account_id\":\"acct_demo\",\"site_id");
  });

  it("an API without the endpoint keeps the plain pending answer", async () => {
    rejectionsStatus = 404;
    const r = (await tool("verify_setup").handler({ account_id: "acct_demo" })) as Record<string, unknown>;
    expect(r.status).toBe("pending");
    expect(r).not.toHaveProperty("cause");
    expect(r).not.toHaveProperty("rejections");
  });

  it("a hit log that could not be read is not reported as zero rejections", async () => {
    rejections = { ...localhostRejections, available: false, rejected: 0, reasons: [] };
    const r = (await tool("verify_setup").handler({ account_id: "acct_demo" })) as Record<string, unknown>;
    expect(r).not.toHaveProperty("cause");
    expect(r).not.toHaveProperty("rejections");
  });
});

describe("verify_event_instrumented pending explains why", () => {
  it("stored hits and no rejections: the event call did not fire", async () => {
    rejections = { ...localhostRejections, accepted: 40, rejected: 0, reasons: [] };
    const r = (await tool("verify_event_instrumented").handler({ account_id: "acct_demo", kind: "micro", name: "add_to_cart" })) as {
      status: string;
      cause: string;
      message: string;
    };
    expect(r.status).toBe("pending");
    expect(r.cause).toMatch(/The tracker runs \(40 hits stored .*\), so either the 'add_to_cart' call did not fire/);
    expect(r.message).toContain(r.cause);
  });

  it("bot_detected on the tester's session", async () => {
    rejections = { ...localhostRejections, rejected: 6, reasons: [{ reason: "bot_detected", count: 6, origins: [{ origin: "https://demo-store.com", count: 6 }] }] };
    const r = (await tool("verify_event_instrumented").handler({ account_id: "acct_demo", kind: "conv", name: "purchase" })) as { cause: string };
    expect(r.cause).toMatch(/bot_detected from https:\/\/demo-store\.com — the session sent many pageviews within seconds/);
  });
});
