import { describe, it, expect } from "vitest";
import { provision, fetchPixelStatus, ProvisionError, PixelStatusError } from "../src/provision.js";

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    headers: { get: (k: string) => headers[k] ?? null },
  })) as unknown as typeof fetch;
}

const opts = (fetchImpl: typeof fetch) => ({ baseUrl: "http://api.test/api/v1", provisionKey: "pk_test", fetchImpl });
const input = { siteName: "Shop", email: "a@b.com", installSource: "mcp" };

const okData = {
  success: true,
  account_id: "acc-1",
  snippet: "<script></script>",
  api_key: "sm_secret",
  dashboard_url: "http://dash",
  claim_url: "http://claim",
  free_quota: { events_total: 1000000 },
  next_steps: [],
};

describe("provision (TEST-3101)", () => {
  it("200 → unwraps the envelope", async () => {
    const res = await provision(input, opts(fakeFetch(200, { success: true, data: okData })));
    expect(res.account_id).toBe("acc-1");
    expect(res.api_key).toBe("sm_secret");
  });

  it("401 → ProvisionError AUTH_REQUIRED", async () => {
    await expect(provision(input, opts(fakeFetch(401, { detail: "invalid" })))).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("409 → ProvisionError EMAIL_EXISTS", async () => {
    await expect(provision(input, opts(fakeFetch(409, {})))).rejects.toMatchObject({ code: "EMAIL_EXISTS" });
  });

  it("429 → ProvisionError RATE_LIMITED with retryAfter", async () => {
    try {
      await provision(input, opts(fakeFetch(429, {}, { "Retry-After": "30" })));
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ProvisionError);
      expect((e as ProvisionError).code).toBe("RATE_LIMITED");
      expect((e as ProvisionError).retryAfter).toBe(30);
    }
  });

  it("503 → ProvisionError PROVISIONING_DISABLED (kill switch)", async () => {
    await expect(provision(input, opts(fakeFetch(503, {})))).rejects.toMatchObject({
      code: "PROVISIONING_DISABLED",
    });
  });

  it("network failure → ProvisionError NETWORK", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(provision(input, opts(failing))).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("200 with missing api_key → BAD_RESPONSE", async () => {
    await expect(
      provision(input, opts(fakeFetch(200, { data: { account_id: "x" } }))),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("fetchPixelStatus (TEST-3101)", () => {
  it("200 → unwraps installed + total_hits", async () => {
    const res = await fetchPixelStatus("acc", {
      baseUrl: "http://api.test/api/v1",
      apiKey: "sm_key",
      fetchImpl: fakeFetch(200, {
        data: { account_id: "acc", installed: true, first_hit_at: null, last_hit_at: null, total_hits: 5 },
      }),
    });
    expect(res.installed).toBe(true);
    expect(res.total_hits).toBe(5);
  });

  it("non-200 → PixelStatusError", async () => {
    await expect(
      fetchPixelStatus("acc", { baseUrl: "http://api.test/api/v1", apiKey: "k", fetchImpl: fakeFetch(500, "boom") }),
    ).rejects.toBeInstanceOf(PixelStatusError);
  });
});
