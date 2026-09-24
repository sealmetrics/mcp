import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SealMetricsClient } from "../src/client.js";
import { SealMetricsAPIError } from "../src/errors.js";
import {
  SITES_RESPONSE,
  OVERVIEW_RESPONSE,
  SOURCES_RESPONSE,
  PAGES_RESPONSE,
  CONVERSIONS_RESPONSE,
  DEVICES_RESPONSE,
  COUNTRIES_RESPONSE,
  FUNNEL_RESPONSE,
} from "./fixtures/api-responses.js";

const BASE_URL = "http://localhost:9999/api/v1";
const API_KEY = "sm_test_key_123";

// MSW server for intercepting HTTP requests
const handlers = [
  http.get(`${BASE_URL}/sites`, ({ request }) => {
    const apiKey = request.headers.get("X-API-Key");
    if (apiKey !== API_KEY) {
      return HttpResponse.json(
        { detail: "Invalid API key" },
        { status: 401 },
      );
    }
    return HttpResponse.json(SITES_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/overview`, ({ request }) => {
    const apiKey = request.headers.get("X-API-Key");
    if (apiKey !== API_KEY) {
      return HttpResponse.json(
        { detail: "Invalid API key" },
        { status: 401 },
      );
    }
    return HttpResponse.json(OVERVIEW_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/sources`, () => {
    return HttpResponse.json(SOURCES_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/pages`, () => {
    return HttpResponse.json(PAGES_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/conversions`, () => {
    return HttpResponse.json(CONVERSIONS_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/devices`, () => {
    return HttpResponse.json(DEVICES_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/geo/countries`, () => {
    return HttpResponse.json(COUNTRIES_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/funnel`, () => {
    return HttpResponse.json(FUNNEL_RESPONSE);
  }),
];

const mockServer = setupServer(...handlers);

beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe("SealMetricsClient", () => {
  const client = new SealMetricsClient(API_KEY, BASE_URL);

  describe("authentication", () => {
    it("sends X-API-Key header", async () => {
      const data = await client.request<{ sites: unknown[] }>("/sites");
      expect(data.sites).toHaveLength(2);
    });

    it("throws on invalid API key", async () => {
      const badClient = new SealMetricsClient("sm_wrong_key", BASE_URL);
      await expect(badClient.request("/sites")).rejects.toThrow(
        SealMetricsAPIError,
      );
      await expect(badClient.request("/sites")).rejects.toThrow(
        /Invalid API key/,
      );
    });
  });

  describe("request", () => {
    it("parses API envelope and returns data", async () => {
      const data = await client.request<{
        date_range: { days: number };
        traffic: { entrances: number };
      }>("/stats/overview", { site_id: "my-store" });
      expect(data.date_range.days).toBe(31);
      expect(data.traffic.entrances).toBe(5000);
    });

    it("passes query parameters", async () => {
      let capturedUrl = "";
      mockServer.use(
        http.get(`${BASE_URL}/stats/sources`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(SOURCES_RESPONSE);
        }),
      );

      await client.request("/stats/sources", {
        site_id: "my-store",
        period: "7d",
        page_size: "10",
      });

      const url = new URL(capturedUrl);
      expect(url.searchParams.get("site_id")).toBe("my-store");
      expect(url.searchParams.get("period")).toBe("7d");
      expect(url.searchParams.get("page_size")).toBe("10");
    });

    it("requestPaginated returns data with pagination metadata", async () => {
      const result = await client.requestPaginated("/stats/sources", {
        site_id: "my-store",
      });
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.page_size).toBe(20);
      expect(result.has_next).toBe(false);
    });

    it("omits undefined params", async () => {
      let capturedUrl = "";
      mockServer.use(
        http.get(`${BASE_URL}/stats/sources`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(SOURCES_RESPONSE);
        }),
      );

      await client.request("/stats/sources", {
        site_id: "my-store",
        compare: undefined,
      });

      const url = new URL(capturedUrl);
      expect(url.searchParams.has("compare")).toBe(false);
    });
  });

  describe("error handling", () => {
    it("maps 403 to access denied", async () => {
      mockServer.use(
        http.get(`${BASE_URL}/stats/overview`, () => {
          return HttpResponse.json(
            { detail: "Forbidden" },
            { status: 403 },
          );
        }),
      );

      await expect(
        client.request("/stats/overview", { site_id: "secret-site" }),
      ).rejects.toThrow(/Access denied/);
    });

    it("PRD-055 RF-A06: a 403 keeps the API detail so scope vs site access is distinguishable", async () => {
      mockServer.use(
        http.post(`${BASE_URL}/channel-groups/test`, () => {
          // Real SealMetrics envelope (main.py http_exception_handler).
          return HttpResponse.json(
            {
              error: { code: "forbidden", message: "Required scope: one of read, sites:read" },
              request_id: "req-1",
            },
            { status: 403 },
          );
        }),
      );

      await expect(client.post("/channel-groups/test?account_id=my-store", {})).rejects.toThrow(
        /Access denied.*Required scope: one of read, sites:read/,
      );
    });

    it("PRD-055 RF-A06: the site-scoped 403 keeps the API detail too (bare FastAPI detail)", async () => {
      mockServer.use(
        http.get(`${BASE_URL}/stats/overview`, () => {
          return HttpResponse.json(
            { detail: "Access denied to account: secret-site" },
            { status: 403 },
          );
        }),
      );

      await expect(
        client.request("/stats/overview", { site_id: "secret-site" }),
      ).rejects.toThrow(/Access denied to site "secret-site".*Access denied to account: secret-site/);
    });

    it("PRD-055 RF-A06: a 403 with a non-JSON body still maps cleanly", async () => {
      mockServer.use(
        http.get(`${BASE_URL}/stats/overview`, () => {
          return new HttpResponse("Forbidden", { status: 403 });
        }),
      );

      await expect(client.request("/stats/overview", {})).rejects.toThrow(
        /^Access denied\. Your API key does not have the required permissions\.$/,
      );
    });

    it("maps 404 to site not found", async () => {
      mockServer.use(
        http.get(`${BASE_URL}/stats/overview`, () => {
          return HttpResponse.json(
            { detail: "Not found" },
            { status: 404 },
          );
        }),
      );

      await expect(
        client.request("/stats/overview", { site_id: "nonexistent" }),
      ).rejects.toThrow(/not found/);
    });

    it("maps 422 to validation error", async () => {
      mockServer.use(
        http.get(`${BASE_URL}/stats/overview`, () => {
          return HttpResponse.json(
            {
              detail: [
                { loc: ["query", "period"], msg: "invalid period value" },
              ],
            },
            { status: 422 },
          );
        }),
      );

      await expect(
        client.request("/stats/overview", { site_id: "my-store" }),
      ).rejects.toThrow(/Invalid request parameters/);
    });

    it("retries on 429", async () => {
      let attempts = 0;
      mockServer.use(
        http.get(`${BASE_URL}/stats/overview`, () => {
          attempts++;
          if (attempts <= 2) {
            return HttpResponse.json(
              { detail: "Rate limited" },
              { status: 429 },
            );
          }
          return HttpResponse.json(OVERVIEW_RESPONSE);
        }),
      );

      const data = await client.request<{ traffic: { entrances: number } }>(
        "/stats/overview",
        { site_id: "my-store" },
      );
      expect(data.traffic.entrances).toBe(5000);
      expect(attempts).toBe(3);
    });

    it("retries on 500 and eventually throws", async () => {
      mockServer.use(
        http.get(`${BASE_URL}/stats/overview`, () => {
          return HttpResponse.json(
            { detail: "Internal error" },
            { status: 500 },
          );
        }),
      );

      await expect(
        client.request("/stats/overview", { site_id: "my-store" }),
      ).rejects.toThrow(/temporarily unavailable/);
    });
  });
});

describe("Tool handlers", () => {
  const client = new SealMetricsClient(API_KEY, BASE_URL);

  it("list_sites returns formatted site list", async () => {
    const { listSitesTool } = await import("../src/tools/sites.js");
    const result = (await listSitesTool.handler(client, {})) as Array<{
      site_id: string;
      domains: string[];
    }>;
    expect(result).toHaveLength(2);
    expect(result[0].site_id).toBe("my-store");
    expect(result[0].domains).toEqual(["mystore.com"]);
  });

  it("get_overview returns traffic data", async () => {
    const { getOverviewTool } = await import("../src/tools/overview.js");
    const result = (await getOverviewTool.handler(client, {
      site_id: "my-store",
    })) as { traffic: { entrances: number } };
    expect(result.traffic.entrances).toBe(5000);
  });

  it("get_traffic_sources returns paginated result with metadata", async () => {
    const { getTrafficSourcesTool } = await import(
      "../src/tools/traffic.js"
    );
    const result = (await getTrafficSourcesTool.handler(client, {
      site_id: "my-store",
    })) as { data: unknown[]; total: number; has_next: boolean };
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.has_next).toBe(false);
  });

  it("get_devices returns device breakdown", async () => {
    const { getDevicesTool } = await import("../src/tools/audience.js");
    const result = (await getDevicesTool.handler(client, {
      site_id: "my-store",
    })) as { by_device: unknown[]; by_browser: unknown[]; by_os: unknown[] };
    expect(result.by_device).toBeDefined();
    expect(result.by_browser).toBeDefined();
    expect(result.by_os).toBeDefined();
  });

  it("get_funnel returns funnel steps", async () => {
    const { getFunnelTool } = await import("../src/tools/funnel.js");
    const result = (await getFunnelTool.handler(client, {
      site_id: "my-store",
    })) as { steps: unknown[]; overall_conversion_rate: number };
    expect(result.steps).toHaveLength(4);
    expect(result.overall_conversion_rate).toBe(1.6);
  });
});

describe("resolveSiteId", () => {
  it("uses site_id from args", async () => {
    const { resolveSiteId } = await import("../src/tools/shared.js");
    expect(resolveSiteId({ site_id: "test-site" })).toBe("test-site");
  });

  it("falls back to env var", async () => {
    const { resolveSiteId } = await import("../src/tools/shared.js");
    const original = process.env.SEALMETRICS_SITE_ID;
    process.env.SEALMETRICS_SITE_ID = "env-site";
    try {
      expect(resolveSiteId({})).toBe("env-site");
    } finally {
      if (original === undefined) {
        delete process.env.SEALMETRICS_SITE_ID;
      } else {
        process.env.SEALMETRICS_SITE_ID = original;
      }
    }
  });

  it("throws when no site_id available", async () => {
    const { resolveSiteId } = await import("../src/tools/shared.js");
    const original = process.env.SEALMETRICS_SITE_ID;
    delete process.env.SEALMETRICS_SITE_ID;
    try {
      expect(() => resolveSiteId({})).toThrow(/site_id is required/);
    } finally {
      if (original !== undefined) {
        process.env.SEALMETRICS_SITE_ID = original;
      }
    }
  });

  it("keeps the env-var hint on stdio (PRD-043 RF-005 parametrizes it per transport)", async () => {
    const { resolveSiteId } = await import("../src/tools/shared.js");
    const original = process.env.SEALMETRICS_SITE_ID;
    delete process.env.SEALMETRICS_SITE_ID;
    try {
      expect(() => resolveSiteId({})).toThrow(/SEALMETRICS_SITE_ID environment variable/);
    } finally {
      if (original !== undefined) {
        process.env.SEALMETRICS_SITE_ID = original;
      }
    }
  });
});
