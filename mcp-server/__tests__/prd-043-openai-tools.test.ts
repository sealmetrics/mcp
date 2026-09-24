/**
 * PRD-043 RF-006 — ChatGPT `search`/`fetch` over a multi-site connection.
 *
 * ChatGPT connectors only ever call these two tools, so with "all my sites" as
 * the consent default they must resolve the site themselves. The contract
 * under test:
 *   - one site named in the query  → that site's reports
 *   - nothing / several named      → the SITES as results, never reports of all
 *   - `fetch('site:<id>')`         → the site card + its report ids
 *
 * DEC-07 (observing real ChatGPT behavior in PRE) may still tune the wording
 * and the cap; these tests pin the shape, not the copy.
 */
import { describe, it, expect } from "vitest";
import type { SealMetricsClient } from "../src/client.js";
import type { SiteInfo } from "../src/types.js";
import {
  createOpenAICompatTools,
  matchSites,
  parseReportId,
} from "../src/remote/openai-tools.js";

const SITES: SiteInfo[] = [
  {
    id: "myshop",
    name: "My Shop",
    domains: ["myshop.com", "www.myshop.com"],
    timezone: "Europe/Madrid",
    currency: "EUR",
    is_active: true,
    created_at: "2026-01-01",
  },
  {
    id: "other-store",
    name: "Other Store",
    domains: ["otherstore.io"],
    timezone: "UTC",
    currency: "EUR",
    is_active: true,
    created_at: "2026-02-01",
  },
];

interface SearchResult {
  results: Array<{ id: string; title: string; url: string }>;
}

interface FetchResult {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: Record<string, unknown>;
}

/** Client stub: `/sites` returns SITES, everything else an empty report. */
function fakeClient(captured: Array<Record<string, unknown>> = []): SealMetricsClient {
  return {
    request: async (path: string) => {
      if (path === "/sites") return { sites: SITES, total: SITES.length };
      return {};
    },
    requestDirect: async (path: string, params?: Record<string, unknown>) => {
      captured.push({ path, ...params });
      return { data: [] };
    },
  } as unknown as SealMetricsClient;
}

const DASHBOARD = "https://my.sealmetrics.example";

function tools(accountId?: string) {
  const [search, fetchTool] = createOpenAICompatTools({ accountId, dashboardUrl: DASHBOARD });
  return { search, fetchTool };
}

describe("PRD-043 RF-006 — id parsing and site matching", () => {
  it("parses ids right-to-left (site ids can never contain ':')", () => {
    expect(parseReportId("overview:30d")).toEqual({
      siteId: undefined,
      key: "overview",
      period: "30d",
    });
    expect(parseReportId("my-shop:landing-pages:7d")).toEqual({
      siteId: "my-shop",
      key: "landing-pages",
      period: "7d",
    });
  });

  it("matches a site by name, id or domain (www-insensitive)", () => {
    expect(matchSites(SITES, "conversions for myshop.com last week").map((s) => s.id)).toEqual([
      "myshop",
    ]);
    expect(matchSites(SITES, "how did Other Store do?").map((s) => s.id)).toEqual([
      "other-store",
    ]);
    expect(matchSites(SITES, "how many visits yesterday?")).toEqual([]);
  });
});

describe("PRD-043 RF-006 — single-site connection is unchanged", () => {
  it("search returns bare report ids and fetch uses the connection's site", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const { search, fetchTool } = tools("myshop");

    const found = (await search.handler(fakeClient(), {
      query: "conversions last week",
    })) as SearchResult;
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results[0].id).toBe("conversions:last_week");

    const report = (await fetchTool.handler(fakeClient(captured), {
      id: "conversions:7d",
    })) as FetchResult;
    expect(report.id).toBe("conversions:7d");
    expect(captured[0].site_id).toBe("myshop");
  });
});

describe("PRD-043 RF-006 — multi-site connection", () => {
  it("a query naming one site returns that site's reports, site-qualified", async () => {
    const { search } = tools();
    const found = (await search.handler(fakeClient(), {
      query: "conversions on myshop.com last week",
    })) as SearchResult;
    expect(found.results.every((r) => r.id.startsWith("myshop:"))).toBe(true);
    expect(found.results[0].id).toBe("myshop:conversions:last_week");
  });

  it("a query naming no site returns the SITES, never reports of all of them", async () => {
    const { search } = tools();
    const found = (await search.handler(fakeClient(), {
      query: "how many visits yesterday?",
    })) as SearchResult;
    expect(found.results.map((r) => r.id)).toEqual(["site:myshop", "site:other-store"]);
  });

  it("fetch of a site id returns the site card and its report ids", async () => {
    const { fetchTool } = tools();
    const card = (await fetchTool.handler(fakeClient(), { id: "site:myshop" })) as FetchResult;
    expect(card.metadata.site_id).toBe("myshop");
    expect(card.text).toContain("myshop:overview:30d");
  });

  it("fetch of a site-qualified report id queries that site", async () => {
    const captured: Array<Record<string, unknown>> = [];
    const { fetchTool } = tools();
    const report = (await fetchTool.handler(fakeClient(captured), {
      id: "other-store:overview:7d",
    })) as FetchResult;
    expect(report.id).toBe("other-store:overview:7d");
    expect(captured[0].site_id).toBe("other-store");
    expect(captured[0].period).toBe("7d");
  });

  it("fetch of a bare report id explains that the site must be named", async () => {
    const { fetchTool } = tools();
    await expect(fetchTool.handler(fakeClient(), { id: "overview:7d" })).rejects.toThrow(
      /does not name a site/,
    );
  });

  it("fetch of an unknown site id points back at search", async () => {
    const { fetchTool } = tools();
    await expect(fetchTool.handler(fakeClient(), { id: "site:nope" })).rejects.toThrow(
      /Unknown site/,
    );
  });
});
