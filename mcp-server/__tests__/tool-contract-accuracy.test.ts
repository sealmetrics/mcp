/**
 * Tool contracts must match what the handlers and the API actually do: the
 * model reads descriptions and schemas literally.
 *
 * - get_funnel reads GET /stats/funnel, which has no APIResponse envelope,
 *   caps `limit` at 500 and sends named UTM arguments as `filters`.
 * - The raw tools cap `limit` at 100 in the handler, not just in prose.
 * - The listed JSON Schema advertises each tool's `required` arguments.
 * - `site_id` never tells a remote client to set an env var it cannot set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SealMetricsClient } from "../src/client.js";
import { buildServer } from "../src/server.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { getFunnelTool } from "../src/tools/funnel.js";
import {
  getConversionsRawTool,
  getMicroconversionsRawTool,
  getConversionItemsRawTool,
} from "../src/tools/conversions.js";

const BASE_URL = "http://localhost:9987/api/v1";
const API_KEY = "sm_test_contract";

const FUNNEL_BODY = {
  account_id: "demo-site",
  date_from: "2026-09-01",
  date_to: "2026-09-22",
  microconversion_types: ["add_to_cart"],
  conversion_types: ["purchase"],
  rows: [
    {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "(none)",
      utm_term: "(none)",
      entrances: 120,
      page_views: 300,
      microconversions: { add_to_cart: 12 },
      conversions: { purchase: 3 },
      revenue: { purchase: 150.5 },
    },
  ],
  totals: {
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_term: "",
    entrances: 120,
    page_views: 300,
    microconversions: { add_to_cart: 12 },
    conversions: { purchase: 3 },
    revenue: { purchase: 150.5 },
  },
};

let requests: URL[] = [];

const mockServer = setupServer(
  http.get(`${BASE_URL}/stats/funnel`, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json(FUNNEL_BODY);
  }),
  http.get(`${BASE_URL}/stats/*`, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json({ success: true, data: [], total: 0, page: 1, page_size: 100, has_next: false });
  }),
);

beforeAll(() => mockServer.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => mockServer.close());
beforeEach(() => {
  requests = [];
});

const client = () => new SealMetricsClient(API_KEY, BASE_URL);

describe("get_funnel", () => {
  it("returns the FunnelResponse body (no envelope to unwrap)", async () => {
    const result = await getFunnelTool.handler(client(), { site_id: "demo-site", period: "30d" });
    expect(result).toEqual(FUNNEL_BODY);
  });

  it("asks for the top 100 rows and no filters by default", async () => {
    await getFunnelTool.handler(client(), { site_id: "demo-site", period: "30d" });
    const params = requests.at(-1)?.searchParams;
    expect(params?.get("limit")).toBe("100");
    expect(params?.has("filters")).toBe(false);
  });

  it("clamps limit to 500", async () => {
    await getFunnelTool.handler(client(), { site_id: "demo-site", period: "30d", limit: 10000 });
    expect(requests.at(-1)?.searchParams.get("limit")).toBe("500");
  });

  it("maps named UTM arguments to the API filters string", async () => {
    await getFunnelTool.handler(client(), {
      site_id: "demo-site",
      period: "30d",
      utm_source: "seedtag",
      utm_medium: "display",
    });
    expect(requests.at(-1)?.searchParams.get("filters")).toBe(
      "utm_source:eq:seedtag,utm_medium:eq:display"
    );
  });

  it("rejects a UTM value with a comma instead of splitting it", async () => {
    await expect(
      getFunnelTool.handler(client(), { site_id: "demo-site", utm_campaign: "a,b" })
    ).rejects.toThrow(/comma/);
  });

  it("describes the UTM table it returns, not per-step dropoff", () => {
    expect(getFunnelTool.description).toMatch(/UTM/);
    expect(getFunnelTool.description).not.toMatch(/dropoff at each stage/);
  });
});

describe("raw tools cap limit at 100", () => {
  const rawTools = [getConversionsRawTool, getMicroconversionsRawTool, getConversionItemsRawTool];

  it.each(rawTools.map((tool) => [tool.name, tool]))("%s clamps limit=500 to page_size=100", async (_name, tool) => {
    await tool.handler(client(), { site_id: "demo-site", period: "7d", limit: 500 });
    expect(requests.at(-1)?.searchParams.get("page_size")).toBe("100");
  });

  it.each(rawTools.map((tool) => [tool.name, tool]))("%s keeps the default of 10", async (_name, tool) => {
    await tool.handler(client(), { site_id: "demo-site", period: "7d" });
    expect(requests.at(-1)?.searchParams.get("page_size")).toBe("10");
  });

  it.each(rawTools.map((tool) => [tool.name, tool]))("%s names the real parameter in its description", (_name, tool) => {
    expect(tool.description).not.toMatch(/page_size capped/);
  });
});

describe("listed schema", () => {
  async function listTools() {
    const { server } = buildServer({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      provisionKey: "pk_mcp_test",
      version: "test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "test", version: "test" });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
    return (await mcpClient.listTools()).tools;
  }

  it("advertises each tool's required arguments", async () => {
    const tools = await listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("get_segment")?.inputSchema.required).toEqual(["segment_id"]);
    expect(byName.get("search_docs")?.inputSchema.required).toEqual(["query"]);
  });

  it("does not invent required arguments for tools without them", async () => {
    const tools = await listTools();
    const overview = tools.find((tool) => tool.name === "get_overview");
    expect(overview?.inputSchema.required ?? []).toEqual([]);
  });
});

describe("site_id description", () => {
  it("never presents the env var as the only way to omit it", () => {
    for (const tool of ALL_TOOLS) {
      const siteId = tool.inputSchema.properties.site_id as { description?: string } | undefined;
      if (!siteId) continue;
      expect(siteId.description, tool.name).not.toMatch(/^Site ID\. Optional if SEALMETRICS_SITE_ID env var is set\.$/);
      expect(siteId.description, tool.name).toMatch(/list_sites/);
    }
  });
});
