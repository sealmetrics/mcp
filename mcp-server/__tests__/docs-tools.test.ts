/**
 * Live documentation tools (search_docs + get_doc over docs.sealmetrics.com).
 *
 *  - TEST-DOC01: llms.txt parsing (sections, titles, paths, Raw: mirrors).
 *  - TEST-DOC02: search ranking, limit, empty-result shape.
 *  - TEST-DOC03: index cache (one llms.txt fetch across calls; clearable).
 *  - TEST-DOC04: get_doc fetch, index.txt fallback, truncation, 404 error.
 *  - TEST-DOC05: path normalization + rejection of foreign hosts/invalid paths.
 *  - TEST-DOC06: read-only gate (listed with api_key, hidden without).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import {
  parseLlmsIndex,
  searchIndex,
  normalizeDocPath,
  clearDocsIndexCache,
  searchDocsTool,
  getDocTool,
  DOCS_BASE_URL,
} from "../src/tools/docs.js";

const LLMS_FIXTURE = `# Sealmetrics

> Privacy-first analytics platform.

## Documentation

Base URL: ${DOCS_BASE_URL}

### Getting Started

- [First Steps Overview](${DOCS_BASE_URL}/getting-started): Start your journey with Sealmetrics.

  Raw: ${DOCS_BASE_URL}/docs-raw/getting-started/index.txt

- [First Steps with Sealmetrics](${DOCS_BASE_URL}/getting-started/quick-start): Get started in under 5 minutes.

  Raw: ${DOCS_BASE_URL}/docs-raw/getting-started/quick-start.txt

### Integrations

- [Shopify Integration](${DOCS_BASE_URL}/integrations/shopify): Install the tracker in your Shopify store.

  Raw: ${DOCS_BASE_URL}/docs-raw/integrations/shopify.txt

- [Google Tag Manager](${DOCS_BASE_URL}/integrations/gtm): Deploy Sealmetrics through GTM.

  Raw: ${DOCS_BASE_URL}/docs-raw/integrations/gtm.txt
`;

function mockFetch(routes: Record<string, { status: number; body: string }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return {
      status: route.status,
      ok: route.status >= 200 && route.status < 300,
      text: async () => route.body,
    } as Response;
  });
}

beforeEach(() => clearDocsIndexCache());
afterEach(() => vi.unstubAllGlobals());

describe("TEST-DOC01: llms.txt parsing", () => {
  it("parses entries with section, path, description and Raw mirror", () => {
    const entries = parseLlmsIndex(LLMS_FIXTURE);
    expect(entries).toHaveLength(4);
    expect(entries[1]).toEqual({
      title: "First Steps with Sealmetrics",
      path: "getting-started/quick-start",
      url: `${DOCS_BASE_URL}/getting-started/quick-start`,
      rawUrl: `${DOCS_BASE_URL}/docs-raw/getting-started/quick-start.txt`,
      description: "Get started in under 5 minutes.",
      section: "Getting Started",
    });
    expect(entries[2].section).toBe("Integrations");
  });

  it("derives a default rawUrl when the Raw: line is missing", () => {
    const entries = parseLlmsIndex(`- [Solo](${DOCS_BASE_URL}/solo-page): No raw line.`);
    expect(entries[0].rawUrl).toBe(`${DOCS_BASE_URL}/docs-raw/solo-page.txt`);
  });
});

describe("TEST-DOC02: search ranking", () => {
  const entries = parseLlmsIndex(LLMS_FIXTURE);

  it("ranks title matches first and respects the limit", () => {
    const results = searchIndex(entries, "shopify tracker", 8);
    expect(results[0].path).toBe("integrations/shopify");
    expect(searchIndex(entries, "getting started", 1)).toHaveLength(1);
  });

  it("returns empty for no matches", () => {
    expect(searchIndex(entries, "zzz-nonexistent", 8)).toEqual([]);
  });
});

describe("TEST-DOC03: search_docs handler + index cache", () => {
  it("fetches llms.txt once across calls and returns result shape", async () => {
    const fetchMock = mockFetch({
      [`${DOCS_BASE_URL}/llms.txt`]: { status: 200, body: LLMS_FIXTURE },
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = (await searchDocsTool.handler({} as never, { query: "shopify" })) as {
      results: { path: string; title: string }[];
      total_pages_indexed: number;
    };
    expect(first.total_pages_indexed).toBe(4);
    expect(first.results[0].path).toBe("integrations/shopify");

    await searchDocsTool.handler({} as never, { query: "gtm" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached

    clearDocsIndexCache();
    await searchDocsTool.handler({} as never, { query: "gtm" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty query", async () => {
    await expect(searchDocsTool.handler({} as never, { query: "  " })).rejects.toThrow(/query/);
  });
});

describe("TEST-DOC04: get_doc handler", () => {
  it("fetches the raw page mirror", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        [`${DOCS_BASE_URL}/docs-raw/integrations/shopify.txt`]: { status: 200, body: "# Shopify\ncontent" },
      }),
    );
    const result = (await getDocTool.handler({} as never, { path: "integrations/shopify" })) as {
      path: string;
      url: string;
      content: string;
    };
    expect(result.path).toBe("integrations/shopify");
    expect(result.url).toBe(`${DOCS_BASE_URL}/integrations/shopify`);
    expect(result.content).toContain("# Shopify");
  });

  it("falls back to <path>/index.txt for section landing pages", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        [`${DOCS_BASE_URL}/docs-raw/getting-started.txt`]: { status: 404, body: "not found" },
        [`${DOCS_BASE_URL}/docs-raw/getting-started/index.txt`]: { status: 200, body: "landing" },
      }),
    );
    const result = (await getDocTool.handler({} as never, { path: "getting-started" })) as {
      content: string;
    };
    expect(result.content).toBe("landing");
  });

  it("throws a search_docs hint when the page does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        [`${DOCS_BASE_URL}/docs-raw/nope.txt`]: { status: 404, body: "" },
        [`${DOCS_BASE_URL}/docs-raw/nope/index.txt`]: { status: 404, body: "" },
      }),
    );
    await expect(getDocTool.handler({} as never, { path: "nope" })).rejects.toThrow(/search_docs/);
  });

  it("truncates oversized pages", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        [`${DOCS_BASE_URL}/docs-raw/big.txt`]: { status: 200, body: "x".repeat(70_000) },
      }),
    );
    const result = (await getDocTool.handler({} as never, { path: "big" })) as {
      content: string;
      truncated?: boolean;
    };
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("(truncated)");
    expect(result.content.length).toBeLessThan(70_000);
  });
});

describe("TEST-DOC05: path normalization", () => {
  it("accepts paths, full URLs and raw URLs", () => {
    expect(normalizeDocPath("getting-started/quick-start")).toBe("getting-started/quick-start");
    expect(normalizeDocPath("/getting-started/quick-start/")).toBe("getting-started/quick-start");
    expect(normalizeDocPath(`${DOCS_BASE_URL}/getting-started/quick-start`)).toBe(
      "getting-started/quick-start",
    );
    expect(normalizeDocPath(`${DOCS_BASE_URL}/docs-raw/integrations/gtm.txt`)).toBe("integrations/gtm");
    expect(normalizeDocPath("Getting-Started#anchor")).toBe("getting-started");
  });

  it("rejects foreign hosts and invalid paths", () => {
    expect(() => normalizeDocPath("https://evil.example.com/x")).toThrow(/host/);
    expect(() => normalizeDocPath("../etc/passwd")).toThrow(/Invalid documentation path/);
    expect(() => normalizeDocPath("")).toThrow(/Invalid documentation path/);
  });
});

describe("TEST-DOC06: read-only gate", () => {
  async function connect(apiKey?: string) {
    const { server } = buildServer({
      apiKey,
      baseUrl: "http://localhost:9999/api/v1",
      provisionKey: "pk_mcp_test",
      version: "test",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "test" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it("search_docs and get_doc are listed WITH an api_key", async () => {
    const client = await connect("sm_test_key");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("search_docs");
    expect(names).toContain("get_doc");
  });

  it("are hidden WITHOUT an api_key", async () => {
    const client = await connect(undefined);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("search_docs");
    expect(names).not.toContain("get_doc");
  });
});
