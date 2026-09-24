/**
 * Tests for PRD 08 — MCP/BigQuery extensions of PRD 03.
 *
 * Covers:
 *   TEST-001 / TEST-002 / TEST-003 — `properties` opt-in behavior on raw tools.
 *   TEST-004 — page_size cap (max 100) is enforced before hitting the API.
 *   TEST-005 / TEST-006 / TEST-007 — multi-value filters and `include` on
 *   /stats/pages serialize as repeated query params (FastAPI list semantics).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SealMetricsClient } from "../src/client.js";

const BASE_URL = "http://localhost:9999/api/v1";
const API_KEY = "sm_test_key_123";

const RAW_CONVERSIONS_RESPONSE = {
  success: true,
  data: [
    {
      date: "2026-04-15",
      hour: 12,
      timestamp_utc: "2026-04-15T12:34:56.789Z",
      timestamp_local: "2026-04-15T14:34:56.789+02:00",
      conversion_type: "purchase",
      amount: "59.99",
      properties: { order_id: "X-1", note: "vip" },
      utm_source: "google",
      utm_medium: "cpc",
      country: "ES",
      device_type: "desktop",
      browser: "Chrome",
      os: "macOS",
      channel_group: "Paid Search",
    },
    {
      date: "2026-04-15",
      hour: 13,
      timestamp_utc: "2026-04-15T13:00:00.000Z",
      timestamp_local: "2026-04-15T15:00:00.000+02:00",
      conversion_type: "purchase",
      amount: "120.00",
      properties: { order_id: "X-2" },
      utm_source: "(direct)",
      utm_medium: "(none)",
      country: "PT",
      device_type: "mobile",
      browser: "Safari",
      os: "iOS",
      channel_group: "Direct",
    },
  ],
  total: 2,
  page: 1,
  page_size: 10,
  has_next: false,
  has_prev: false,
  timestamp: "2026-04-15T13:00:00Z",
};

const RAW_ITEMS_RESPONSE = {
  success: true,
  data: [
    {
      date: "2026-04-15",
      hour: 12,
      timestamp_utc: "2026-04-15T12:34:56.789Z",
      timestamp_local: "2026-04-15T14:34:56.789+02:00",
      conversion_type: "purchase",
      properties: { sku: "ABC-1", price: "10.00", quantity: "2" },
      country: "ES",
      device_type: "desktop",
      channel_group: "Paid Search",
    },
  ],
  total: 1,
  page: 1,
  page_size: 10,
  has_next: false,
  has_prev: false,
  timestamp: "2026-04-15T12:34:56Z",
};

const PAGES_RESPONSE = {
  success: true,
  data: [
    { path: "/", entrances: 1, engaged_entrances: 1, page_views: 5 },
  ],
  total: 1,
  page: 1,
  page_size: 20,
  has_next: false,
  has_prev: false,
  timestamp: "2026-04-15T12:00:00Z",
};

let lastRequestUrl = "";

const handlers = [
  http.get(`${BASE_URL}/stats/conversions/raw`, ({ request }) => {
    lastRequestUrl = request.url;
    return HttpResponse.json(RAW_CONVERSIONS_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/microconversions/raw`, ({ request }) => {
    lastRequestUrl = request.url;
    return HttpResponse.json(RAW_CONVERSIONS_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/conversion-items/raw`, ({ request }) => {
    lastRequestUrl = request.url;
    return HttpResponse.json(RAW_ITEMS_RESPONSE);
  }),
  http.get(`${BASE_URL}/stats/pages`, ({ request }) => {
    lastRequestUrl = request.url;
    return HttpResponse.json(PAGES_RESPONSE);
  }),
];

const mockServer = setupServer(...handlers);

beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mockServer.resetHandlers();
  lastRequestUrl = "";
});
afterAll(() => mockServer.close());

interface PaginatedRow {
  data: Array<Record<string, unknown>>;
  total: number;
  page: number;
  has_next: boolean;
}

describe("PRD 08 — raw conversion tools", () => {
  const client = new SealMetricsClient(API_KEY, BASE_URL);

  it("TEST-001: get_conversions_raw excludes `properties` by default", async () => {
    const { getConversionsRawTool } = await import("../src/tools/conversions.js");
    const result = (await getConversionsRawTool.handler(client, {
      site_id: "my-store",
      period: "30d",
    })) as PaginatedRow;
    expect(result.data).toHaveLength(2);
    for (const row of result.data) {
      expect(row).not.toHaveProperty("properties");
      // Other fields stay intact.
      expect(row).toHaveProperty("conversion_type");
      expect(row).toHaveProperty("timestamp_utc");
    }
    // Pagination metadata is unaffected by the strip.
    expect(result.total).toBe(2);
  });

  it("TEST-002: get_conversions_raw with include_properties=true keeps the field", async () => {
    const { getConversionsRawTool } = await import("../src/tools/conversions.js");
    const result = (await getConversionsRawTool.handler(client, {
      site_id: "my-store",
      include_properties: true,
    })) as PaginatedRow;
    expect(result.data[0]).toHaveProperty("properties");
    expect(
      (result.data[0] as { properties: Record<string, string> }).properties
        .order_id,
    ).toBe("X-1");
  });

  it("TEST-002b: get_microconversions_raw excludes properties by default and includes when asked", async () => {
    const { getMicroconversionsRawTool } = await import(
      "../src/tools/conversions.js"
    );
    const without = (await getMicroconversionsRawTool.handler(client, {
      site_id: "my-store",
    })) as PaginatedRow;
    expect(without.data[0]).not.toHaveProperty("properties");

    const withProps = (await getMicroconversionsRawTool.handler(client, {
      site_id: "my-store",
      include_properties: true,
    })) as PaginatedRow;
    expect(withProps.data[0]).toHaveProperty("properties");
  });

  it("TEST-003: get_conversion_items_raw always includes `properties`", async () => {
    const { getConversionItemsRawTool } = await import(
      "../src/tools/conversions.js"
    );
    const result = (await getConversionItemsRawTool.handler(client, {
      site_id: "my-store",
    })) as PaginatedRow;
    expect(result.data[0]).toHaveProperty("properties");
    // The schema does NOT expose `include_properties` for items.
    const props = Object.keys(getConversionItemsRawTool.inputSchema.properties);
    expect(props).not.toContain("include_properties");
  });

  it("TEST-004: limit > 100 fails JSON Schema validation (max=100)", async () => {
    const { getConversionsRawTool } = await import("../src/tools/conversions.js");
    const limitSchema = (
      getConversionsRawTool.inputSchema.properties as Record<
        string,
        { maximum?: number; minimum?: number }
      >
    ).limit;
    expect(limitSchema.maximum).toBe(100);
    expect(limitSchema.minimum).toBe(1);
  });
});

describe("PRD 08 — pages multi-value filters and include", () => {
  const client = new SealMetricsClient(API_KEY, BASE_URL);

  it("TEST-005: device_type=['mobile','desktop'] serializes as repeated query params", async () => {
    const { getPagesTool } = await import("../src/tools/pages.js");
    await getPagesTool.handler(client, {
      site_id: "my-store",
      device_type: ["mobile", "desktop"],
    });
    const url = new URL(lastRequestUrl);
    const values = url.searchParams.getAll("device_type");
    expect(values).toEqual(["mobile", "desktop"]);
    // Sanity: no comma-joined CSV.
    expect(url.search).not.toContain("device_type=mobile%2Cdesktop");
  });

  it("TEST-006: include=['device','channel_group'] sends each value separately", async () => {
    const { getPagesTool } = await import("../src/tools/pages.js");
    await getPagesTool.handler(client, {
      site_id: "my-store",
      include: ["device", "channel_group"],
    });
    const url = new URL(lastRequestUrl);
    expect(url.searchParams.getAll("include")).toEqual([
      "device",
      "channel_group",
    ]);
  });

  it("TEST-007: get_pages without new params produces the legacy URL shape", async () => {
    const { getPagesTool } = await import("../src/tools/pages.js");
    await getPagesTool.handler(client, { site_id: "my-store" });
    const url = new URL(lastRequestUrl);
    expect(url.pathname).toBe("/api/v1/stats/pages");
    // Only the previously-existing params are present.
    const keys = [...url.searchParams.keys()].sort();
    expect(keys).toEqual(
      ["page_size", "period", "site_id", "sort_by", "sort_order"].sort(),
    );
    // No multi-value filter accidentally smuggled in.
    expect(url.searchParams.has("device_type")).toBe(false);
    expect(url.searchParams.has("country")).toBe(false);
    expect(url.searchParams.has("include")).toBe(false);
  });

  it("country still accepts the array form in the JSON Schema for get_pages", async () => {
    // PRD-08 made `country` multi-value (was a bare string). PRD-062 widened
    // it again to `string | string[]` via `anyOf`, so a model can filter by one
    // country without wrapping it — the array branch must still be there.
    const { getPagesTool } = await import("../src/tools/pages.js");
    const props = getPagesTool.inputSchema.properties as Record<
      string,
      { type?: string; items?: { type: string }; anyOf?: { type: string; items?: { type: string } }[] }
    >;
    const arrayBranch = props.country.anyOf?.find((entry) => entry.type === "array");
    expect(arrayBranch).toBeDefined();
    expect(arrayBranch?.items?.type).toBe("string");
    expect(props.country.anyOf?.some((entry) => entry.type === "string")).toBe(true);
  });

  it("include schema declares the allowed enum so the LLM gets validation hints", async () => {
    const { getPagesTool } = await import("../src/tools/pages.js");
    const props = getPagesTool.inputSchema.properties as Record<
      string,
      { items?: { enum?: string[] } }
    >;
    expect(props.include.items?.enum).toEqual([
      "device",
      "browser",
      "os",
      "channel_group",
    ]);
  });
});
