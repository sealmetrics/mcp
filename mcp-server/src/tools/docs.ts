import type { SealMetricsClient } from "../client.js";
import type { ToolDef } from "./index.js";

/**
 * Live documentation tools (`search_docs` + `get_doc`).
 *
 * Unlike the marketing/troubleshooting skills (embedded at build time, stale
 * until the next npm release), these fetch the PUBLIC docs site live, so the
 * answer always reflects the currently published documentation:
 *
 *  - docs.sealmetrics.com publishes an `llms.txt` index (title + URL + one-line
 *    description per page) and a plain-text mirror of every page under
 *    `/docs-raw/<path>.txt`. Both are static GitHub Pages assets with CORS `*`.
 *  - `search_docs` downloads the index (cached in memory for a few minutes),
 *    ranks pages against the query and returns the matches.
 *  - `get_doc` fetches one page's raw text mirror.
 *
 * Registered in ALL_TOOLS, so they inherit the read-only gate (hidden without
 * an api_key) and are available on both the stdio and remote transports (no
 * API scopes involved — the handlers never touch `client`).
 */

export const DOCS_BASE_URL = "https://docs.sealmetrics.com";
const LLMS_INDEX_URL = `${DOCS_BASE_URL}/llms.txt`;
const INDEX_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
/** Raw pages are small (a few KB); this cap only guards against anomalies. */
const MAX_DOC_CHARS = 60_000;
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 25;

export interface DocsIndexEntry {
  title: string;
  /** Site-relative page path, e.g. "getting-started/quick-start". */
  path: string;
  url: string;
  rawUrl: string;
  description: string;
  section: string;
}

async function fetchWithTimeout(url: string): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/plain, text/markdown, */*" },
      signal: controller.signal,
    });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Documentation site did not respond within ${FETCH_TIMEOUT_MS / 1000}s (${url}).`);
    }
    throw new Error(
      `Could not reach the documentation site (${url}): ${error instanceof Error ? error.message : "network error"}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parse the llms.txt index. Expected shape (one entry per page):
 *
 *   ### Section Title
 *   - [Page Title](https://docs.sealmetrics.com/some/path): One-line description.
 *     Raw: https://docs.sealmetrics.com/docs-raw/some/path.txt
 */
export function parseLlmsIndex(text: string): DocsIndexEntry[] {
  const entries: DocsIndexEntry[] = [];
  let section = "";
  for (const line of text.split("\n")) {
    const heading = line.match(/^#{2,}\s+(.*)/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    const raw = line.match(/^\s*Raw:\s*(\S+)/);
    if (raw && entries.length > 0) {
      entries[entries.length - 1].rawUrl = raw[1];
      continue;
    }
    const entry = line.match(/^-\s+\[(.+?)\]\((https?:\/\/[^)\s]+)\)(?::\s*(.*))?$/);
    if (!entry) continue;
    let path: string;
    try {
      path = new URL(entry[2]).pathname.replace(/^\/+|\/+$/g, "");
    } catch {
      continue;
    }
    if (!path) continue; // the bare base-URL line is not a page
    entries.push({
      title: entry[1].trim(),
      path,
      url: entry[2],
      rawUrl: `${DOCS_BASE_URL}/docs-raw/${path}.txt`, // default; overridden by the Raw: line
      description: (entry[3] ?? "").trim(),
      section,
    });
  }
  return entries;
}

let indexCache: { entries: DocsIndexEntry[]; fetchedAt: number } | null = null;

/** Test hook: drop the in-memory llms.txt cache. */
export function clearDocsIndexCache(): void {
  indexCache = null;
}

async function getDocsIndex(): Promise<DocsIndexEntry[]> {
  if (indexCache && Date.now() - indexCache.fetchedAt < INDEX_CACHE_TTL_MS) {
    return indexCache.entries;
  }
  const { status, text } = await fetchWithTimeout(LLMS_INDEX_URL);
  if (status !== 200) {
    throw new Error(`Documentation index returned HTTP ${status} (${LLMS_INDEX_URL}).`);
  }
  const entries = parseLlmsIndex(text);
  if (entries.length === 0) {
    throw new Error("Documentation index could not be parsed (no pages found in llms.txt).");
  }
  indexCache = { entries, fetchedAt: Date.now() };
  return entries;
}

export function scoreEntry(entry: DocsIndexEntry, query: string, tokens: string[]): number {
  const title = entry.title.toLowerCase();
  const description = entry.description.toLowerCase();
  const pathAndSection = `${entry.path} ${entry.section}`.toLowerCase();
  let score = title.includes(query) ? 5 : 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 3;
    if (pathAndSection.includes(token)) score += 2;
    if (description.includes(token)) score += 1;
  }
  return score;
}

export function searchIndex(
  entries: DocsIndexEntry[],
  query: string,
  limit: number,
): DocsIndexEntry[] {
  const normalized = query.toLowerCase().trim();
  const tokens = [...new Set(normalized.split(/[^a-z0-9]+/).filter((t) => t.length >= 2))];
  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, normalized, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/**
 * Accepts "getting-started/quick-start", "/getting-started/quick-start", a full
 * docs URL, or the raw-mirror URL, and normalizes to the site-relative path.
 */
export function normalizeDocPath(input: string): string {
  let path = input.trim();
  if (/^https?:\/\//i.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      throw new Error(`Invalid documentation URL: ${input}`);
    }
    if (url.hostname !== new URL(DOCS_BASE_URL).hostname) {
      throw new Error(`get_doc only reads ${DOCS_BASE_URL} pages, got host "${url.hostname}".`);
    }
    path = url.pathname;
  }
  path = path
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^docs-raw\//, "")
    .replace(/\.txt$/, "")
    .toLowerCase();
  if (!path || !/^[a-z0-9][a-z0-9/_-]*$/.test(path)) {
    throw new Error(
      `Invalid documentation path "${input}". Use a path from search_docs results, e.g. "getting-started/quick-start".`,
    );
  }
  return path;
}

export const searchDocsTool: ToolDef = {
  name: "search_docs",
  description:
    "Search the official SealMetrics documentation (docs.sealmetrics.com), fetched live. " +
    "Covers tracker installation (WordPress, WooCommerce, Shopify, Magento, PrestaShop, Google Tag Manager, " +
    "React/Next.js/Vue SPAs), conversion and microconversion tracking, UTM/campaign tagging, report and metric " +
    "definitions, API usage, account settings, and privacy/GDPR/consentless questions. " +
    "Returns matching pages with title, path and description.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "What to look for, e.g. 'install tracker shopify' or 'bounce rate definition'.",
      },
      limit: {
        type: "number",
        description: `Max pages to return (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`,
      },
    },
    required: ["query"],
  },
  handler: async (_client: SealMetricsClient, args: Record<string, unknown>) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      throw new Error("search_docs requires a non-empty `query`.");
    }
    const limit = Math.min(
      Math.max(1, typeof args.limit === "number" ? Math.floor(args.limit) : DEFAULT_SEARCH_LIMIT),
      MAX_SEARCH_LIMIT,
    );
    const entries = await getDocsIndex();
    const results = searchIndex(entries, query, limit);
    return {
      query,
      total_pages_indexed: entries.length,
      results: results.map(({ title, path, url, description, section }) => ({
        title,
        path,
        url,
        description,
        section,
      })),
      hint:
        results.length > 0
          ? "Call get_doc with a result's `path` to read the full page."
          : "No pages matched. Try broader or different keywords.",
    };
  },
};

export const getDocTool: ToolDef = {
  name: "get_doc",
  description:
    "Read one page of the official SealMetrics documentation as plain text, fetched live from " +
    "docs.sealmetrics.com. Takes a documentation page path (e.g. 'getting-started/quick-start') " +
    "or a full docs.sealmetrics.com URL.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Documentation page path (e.g. 'getting-started/quick-start') or a full docs URL.",
      },
    },
    required: ["path"],
  },
  handler: async (_client: SealMetricsClient, args: Record<string, unknown>) => {
    if (typeof args.path !== "string" || !args.path.trim()) {
      throw new Error("get_doc requires `path` (from search_docs results).");
    }
    const path = normalizeDocPath(args.path);
    // Section landing pages (e.g. /getting-started) mirror to <path>/index.txt.
    const candidates = [`${DOCS_BASE_URL}/docs-raw/${path}.txt`, `${DOCS_BASE_URL}/docs-raw/${path}/index.txt`];
    for (const rawUrl of candidates) {
      const { status, text } = await fetchWithTimeout(rawUrl);
      if (status === 404) continue;
      if (status !== 200) {
        throw new Error(`Documentation page returned HTTP ${status} (${rawUrl}).`);
      }
      const truncated = text.length > MAX_DOC_CHARS;
      return {
        path,
        url: `${DOCS_BASE_URL}/${path}`,
        content: truncated ? `${text.slice(0, MAX_DOC_CHARS)}\n... (truncated)` : text,
        ...(truncated ? { truncated: true } : {}),
      };
    }
    throw new Error(
      `Documentation page not found: "${path}". Use search_docs to find the right path.`,
    );
  },
};
