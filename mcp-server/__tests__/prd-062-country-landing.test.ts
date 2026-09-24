/**
 * PRD-062 TEST-006: the country contract and the new landing_page filters.
 *
 * - A country name is refused by the MCP itself (DEC-07), with a message the
 *   model can act on and WITHOUT an HTTP call.
 * - `country` reaches /stats/overview and /stats/microconversions (RF-032).
 * - `landing_page` reaches /stats/sources/top and the three raw endpoints,
 *   repeated as a query param where the API expects multi-value (RF-034/035).
 * - The API's own 422 and 400 reach the model with their detail (RF-036).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SealMetricsClient } from "../src/client.js";
import { countryParam, countryListParam } from "../src/tools/shared.js";
import { getOverviewTool } from "../src/tools/overview.js";
import {
  getMicroconversionsTool,
  getConversionsRawTool,
  getMicroconversionsRawTool,
  getConversionItemsRawTool,
} from "../src/tools/conversions.js";
import { getTopSourcesTool } from "../src/tools/traffic.js";
import { getTopChannelsTool } from "../src/tools/channels.js";

const BASE_URL = "http://localhost:9986/api/v1";
const API_KEY = "sm_test_prd062_cl";

let requests: URL[] = [];
let respond: () => Response = () => HttpResponse.json({ success: true, data: [] });

const mockServer = setupServer(
  http.get(`${BASE_URL}/stats/*`, ({ request }) => {
    requests.push(new URL(request.url));
    return respond();
  }),
);

beforeAll(() => mockServer.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => mockServer.close());
beforeEach(() => {
  requests = [];
  respond = () => HttpResponse.json({ success: true, data: [] });
});

const client = () => new SealMetricsClient(API_KEY, BASE_URL);
const site = { site_id: "demo-site" };

describe("countryParam / countryListParam (DEC-03, DEC-07)", () => {
  it("accepts ISO-2 in any case and upper-cases it", () => {
    expect(countryParam({ country: "es" })).toBe("ES");
    expect(countryParam({ country: "ES" })).toBe("ES");
  });

  it("accepts Unknown in any case and returns the pixel's literal", () => {
    expect(countryParam({ country: "unknown" })).toBe("Unknown");
    expect(countryParam({ country: "UNKNOWN" })).toBe("Unknown");
  });

  it("returns undefined when absent", () => {
    expect(countryParam({})).toBeUndefined();
    expect(countryListParam({})).toBeUndefined();
  });

  it("rejects a country name with an actionable message", () => {
    expect(() => countryParam({ country: "Spain" })).toThrow(
      /ISO-3166-1 alpha-2 code \(e\.g\. ES for Spain\) or 'Unknown'/,
    );
    expect(() => countryParam({ country: "Spain" })).toThrow(/get_countries/);
  });

  it("rejects a bad element of a multi-value list", () => {
    expect(countryListParam({ country: ["es", "unknown"] })).toEqual(["ES", "Unknown"]);
    expect(() => countryListParam({ country: ["ES", "SPAIN"] })).toThrow(/Invalid country/);
  });
});

describe("the tools refuse a country name before any HTTP call", () => {
  it("get_top_channels country=Spain never reaches the API", async () => {
    await expect(
      getTopChannelsTool.handler(client(), { ...site, country: "Spain" }),
    ).rejects.toThrow(/Invalid country/);
    expect(requests).toHaveLength(0);
  });

  it("get_top_channels country=ES does reach the API", async () => {
    await getTopChannelsTool.handler(client(), { ...site, country: "ES" });
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get("country")).toBe("ES");
  });
});

describe("RF-032: country reaches overview and microconversions", () => {
  it("get_overview sends country", async () => {
    await getOverviewTool.handler(client(), { ...site, country: "es" });
    expect(requests[0].pathname).toContain("/stats/overview");
    expect(requests[0].searchParams.getAll("country")).toEqual(["ES"]);
  });

  it("get_overview repeats the param for several countries", async () => {
    await getOverviewTool.handler(client(), { ...site, country: ["es", "unknown"] });
    expect(requests[0].searchParams.getAll("country")).toEqual(["ES", "Unknown"]);
  });

  it("get_microconversions sends country", async () => {
    respond = () =>
      HttpResponse.json({ data: [], total: 0, page: 1, page_size: 20, has_next: false });
    await getMicroconversionsTool.handler(client(), { ...site, country: "ES" });
    expect(requests[0].pathname).toContain("/stats/microconversions");
    expect(requests[0].searchParams.get("country")).toBe("ES");
  });
});

describe("RF-034/RF-035: landing_page reaches the endpoints that now accept it", () => {
  it("get_top_sources sends landing_page verbatim", async () => {
    await getTopSourcesTool.handler(client(), { ...site, landing_page: "/Camisetas/" });
    expect(requests[0].pathname).toContain("/stats/sources/top");
    // Sent as typed: the API lower-cases both sides, the trailing slash matters.
    expect(requests[0].searchParams.get("landing_page")).toBe("/Camisetas/");
  });

  it.each([
    ["conversions", getConversionsRawTool, "/stats/conversions/raw"],
    ["microconversions", getMicroconversionsRawTool, "/stats/microconversions/raw"],
    ["conversion items", getConversionItemsRawTool, "/stats/conversion-items/raw"],
  ])("get_%s_raw sends landing_page as a repeated param", async (_label, tool, path) => {
    respond = () =>
      HttpResponse.json({ data: [], total: 0, page: 1, page_size: 10, has_next: false });
    await tool.handler(client(), { ...site, landing_page: ["/a/", "/b/"] });
    expect(requests[0].pathname).toContain(path);
    expect(requests[0].searchParams.getAll("landing_page")).toEqual(["/a/", "/b/"]);
  });

  it("the raw tools accept a single value as well as a list (RF-034)", async () => {
    respond = () =>
      HttpResponse.json({ data: [], total: 0, page: 1, page_size: 10, has_next: false });
    await getConversionsRawTool.handler(client(), {
      ...site,
      landing_page: "/a/",
      utm_source: "google",
    });
    expect(requests[0].searchParams.getAll("landing_page")).toEqual(["/a/"]);
    expect(requests[0].searchParams.getAll("utm_source")).toEqual(["google"]);
  });

  it("a single country string works on the raw tools too", async () => {
    respond = () =>
      HttpResponse.json({ data: [], total: 0, page: 1, page_size: 10, has_next: false });
    await getConversionsRawTool.handler(client(), { ...site, country: "es" });
    expect(requests[0].searchParams.getAll("country")).toEqual(["ES"]);
  });

  it("the raw tools validate country like everyone else", async () => {
    await expect(
      getConversionsRawTool.handler(client(), { ...site, country: ["Spain"] }),
    ).rejects.toThrow(/Invalid country/);
    expect(requests).toHaveLength(0);
  });
});

describe("RF-036: the API's own 4xx reach the model with their reason", () => {
  it("a 422 from the query-parameter pattern arrives naming query.country", async () => {
    respond = () =>
      HttpResponse.json(
        {
          error: {
            code: "validation_error",
            message: "Request validation failed",
            detail: [
              {
                field: "query.country",
                message: "String should match pattern '^(?i:[a-z]{2}|unknown)$'",
                type: "string_pattern_mismatch",
              },
            ],
          },
        },
        { status: 422 },
      );

    await expect(getTopSourcesTool.handler(client(), site)).rejects.toThrow(
      /query\.country: String should match pattern/,
    );
  });

  it("a 400 date-range error arrives with its detail instead of a bare status", async () => {
    respond = () =>
      HttpResponse.json(
        { error: { code: "bad_request", message: "Date range cannot exceed 730 days" } },
        { status: 400 },
      );

    await expect(getTopSourcesTool.handler(client(), site)).rejects.toThrow(
      /Date range cannot exceed 730 days/,
    );
  });
});
