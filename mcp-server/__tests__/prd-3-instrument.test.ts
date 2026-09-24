/**
 * Fase 3 Bloque 4 — verified instrumentation loop (TEST-3401/3402). The
 * verify_event_instrumented tool: taxonomy gate (VAL-3401) + PII gate (VAL-3402)
 * + confirm the event reached the backend by polling the raw endpoint.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { buildServer } from "../src/server.js";
import type { SetupToolDef } from "../src/tools/setup.js";

const BASE_URL = "http://localhost:9997/api/v1";

// A fixed, advancing clock so the recency match is deterministic and the pending
// loop terminates without real sleeps.
const T0 = 1_700_000_000_000;
let clock = T0;
const now = () => {
  const v = clock;
  clock += 50;
  return v;
};
const noSleep = () => Promise.resolve();

let convRows: Array<Record<string, unknown>> = [];

const handlers = [
  http.get(`${BASE_URL}/stats/conversions/raw`, () => HttpResponse.json({ success: true, data: convRows })),
  http.get(`${BASE_URL}/stats/microconversions/raw`, () => HttpResponse.json({ success: true, data: convRows })),
];
const mockServer = setupServer(...handlers);
beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mockServer.resetHandlers();
  convRows = [];
  clock = T0;
});
afterAll(() => mockServer.close());

function verifier(): SetupToolDef {
  const { setupTools } = buildServer({
    apiKey: "sm_existing_key",
    baseUrl: BASE_URL,
    provisionKey: "pk_mcp_test",
    version: "test",
    pollDefaults: { intervalMs: 5, timeoutMs: 2000 },
    now,
    sleep: noSleep,
  });
  const t = setupTools.find((x) => x.name === "verify_event_instrumented");
  if (!t) throw new Error("verify_event_instrumented not found");
  return t;
}

const recentRow = (extra: Record<string, unknown>) => ({
  conversion_type: "purchase",
  timestamp_utc: new Date(T0).toISOString(),
  ...extra,
});

describe("TEST-3401: clean purchase is verified", () => {
  it("a purchase with allowed properties (no order/user ID) → verified", async () => {
    convRows = [recentRow({ properties: { product: "Blue Shirt", currency: "EUR", value: "49.90" } })];
    const res = (await verifier().handler({
      account_id: "acc-9",
      kind: "conv",
      name: "purchase",
    })) as { status: string };
    expect(res.status).toBe("verified");
  });
});

describe("TEST-3402: PII in properties is flagged, not passed silently", () => {
  it("a purchase carrying order_id / email → warning_pii", async () => {
    convRows = [recentRow({ properties: { order_id: "X-123", email: "a@b.com", value: "49.90" } })];
    const res = (await verifier().handler({
      account_id: "acc-9",
      kind: "conv",
      name: "purchase",
    })) as { status: string; pii_properties: Array<{ key: string }> };
    expect(res.status).toBe("warning_pii");
    const keys = res.pii_properties.map((p) => p.key).sort();
    expect(keys).toContain("order_id");
    expect(keys).toContain("email");
  });
});

describe("taxonomy gate (VAL-3401)", () => {
  it("an out-of-taxonomy name is rejected with a suggestion (no backend call needed)", async () => {
    const res = (await verifier().handler({
      account_id: "acc-9",
      kind: "conv",
      name: "purchases",
    })) as { status: string; suggestion?: string };
    expect(res.status).toBe("rejected");
    expect(res.suggestion).toBe("purchase");
  });
});

describe("pending when the event has not arrived yet", () => {
  it("no matching row → pending (loop terminates via advancing clock)", async () => {
    convRows = [];
    const res = (await verifier().handler({
      account_id: "acc-9",
      kind: "conv",
      name: "purchase",
    })) as { status: string };
    expect(res.status).toBe("pending");
  });
});
