/**
 * ChatGPT-compatible `search` + `fetch` tools (B6: RF-RMT60/61, VAL-RMT60).
 *
 * ChatGPT connectors (deep research / company knowledge) require exactly these
 * two read-only tools with OpenAI's compatibility schema:
 *   search(query)  → { results: [{ id, title, url }] }
 *   fetch(id)      → { id, title, text, url, metadata }
 *
 * They are thin wrappers over the existing read-only stats endpoints — zero new
 * API endpoints, same read-only scope. Remote-transport only (never registered
 * on stdio).
 *
 * PRD-043 RF-006: a connection can now cover several sites, and ChatGPT only
 * ever calls these two tools — so they must resolve the site themselves:
 *
 * - Connection with ONE site (`accountId` set, DEC-09): unchanged. Result ids
 *   are `<report>:<period>`.
 * - Several sites: `search` matches the query against the site names/domains.
 *   One match → that site's reports, ids `<site_id>:<report>:<period>`.
 *   Zero or several matches → the SITES themselves come back as results
 *   (`site:<site_id>`), so the user picks one. It never fans out reports over
 *   every site (DEC-04 reinforced).
 *
 * Ids parse right-to-left (`period`, `report`, rest = site_id): the account_id
 * domain is `[a-z0-9-]+`, so a `:` can never be part of it.
 */
import type { SealMetricsClient } from "../client.js";
import type { ToolDef } from "../tools/index.js";
import { VALID_PERIODS, type SiteListResponse, type SiteInfo } from "../types.js";

interface ReportDef {
  key: string;
  title: string;
  keywords: string[];
  endpoint: string;
  /** Extra fixed query params for the endpoint. */
  params?: Record<string, string>;
}

const REPORTS: ReportDef[] = [
  { key: "overview", title: "Overview KPIs (pageviews, entrances, bounce rate, conversions, revenue)", keywords: ["overview", "kpi", "summary", "performance", "dashboard", "traffic", "revenue", "visits"], endpoint: "/stats/overview" },
  { key: "sources", title: "Traffic sources", keywords: ["source", "sources", "acquisition", "referral", "traffic"], endpoint: "/stats/sources" },
  { key: "mediums", title: "Traffic mediums", keywords: ["medium", "mediums", "organic", "cpc", "email"], endpoint: "/stats/mediums" },
  { key: "campaigns", title: "Campaigns", keywords: ["campaign", "campaigns", "utm", "ads", "advertising", "marketing"], endpoint: "/stats/campaigns" },
  { key: "terms", title: "Campaign terms / keywords", keywords: ["term", "terms", "keyword", "keywords"], endpoint: "/stats/terms" },
  { key: "referrers", title: "Top referrers", keywords: ["referrer", "referrers", "backlink", "links"], endpoint: "/stats/referrers/top" },
  { key: "channels", title: "Top channels (default classification)", keywords: ["channel", "channels", "direct", "seo", "social"], endpoint: "/stats/top-channels" },
  { key: "pages", title: "Pages (pageviews per URL)", keywords: ["page", "pages", "url", "content", "views"], endpoint: "/stats/pages" },
  { key: "landing-pages", title: "Landing pages", keywords: ["landing", "entry", "entrance", "entrances"], endpoint: "/stats/landing-pages" },
  { key: "content-groups", title: "Content groups", keywords: ["content group", "content groups", "grouping", "category"], endpoint: "/stats/pages/content-groups" },
  { key: "conversions", title: "Conversions and revenue", keywords: ["conversion", "conversions", "sales", "orders", "purchases", "revenue", "transactions"], endpoint: "/stats/conversions" },
  { key: "microconversions", title: "Microconversions (leads, signups, add-to-cart...)", keywords: ["microconversion", "microconversions", "micro", "lead", "leads", "signup", "signups", "events"], endpoint: "/stats/microconversions" },
  { key: "funnel", title: "Funnel (entrances → microconversions → conversions)", keywords: ["funnel", "journey", "steps"], endpoint: "/stats/funnel" },
  { key: "countries", title: "Countries (geo)", keywords: ["country", "countries", "geo", "geography", "location", "region"], endpoint: "/stats/geo/countries" },
  { key: "devices", title: "Devices", keywords: ["device", "devices", "mobile", "desktop", "tablet"], endpoint: "/stats/devices" },
  { key: "browsers", title: "Browsers", keywords: ["browser", "browsers", "chrome", "safari", "firefox"], endpoint: "/stats/browsers" },
  { key: "operating-systems", title: "Operating systems", keywords: ["os", "operating system", "operating systems", "windows", "android", "ios", "macos"], endpoint: "/stats/operating-systems" },
];

const DEFAULT_PERIOD = "30d";
const DEFAULT_RESULTS: string[] = ["overview", "sources", "pages", "conversions", "campaigns"];
const MAX_RESULTS = 8;
const MAX_TEXT_LENGTH = 80_000;
/** Cap on the "which site did you mean?" listing — a 100-site org must not
 * flood a ChatGPT search result set (RF-006 spike scenario). */
const MAX_SITE_RESULTS = 25;
const SITE_ID_PREFIX = "site:";

/** Map natural-language period mentions in the query to a valid API period. */
export function detectPeriod(query: string): string {
  const q = query.toLowerCase();
  const patterns: Array<[RegExp, string]> = [
    [/\btoday\b/, "today"],
    [/\byesterday\b/, "yesterday"],
    [/\b(last\s*7\s*days?|past\s*week|7d)\b/, "7d"],
    [/\b(last\s*30\s*days?|past\s*month|30d)\b/, "30d"],
    [/\b(last\s*90\s*days?|past\s*quarter|90d)\b/, "90d"],
    [/\b(last\s*12\s*months?|past\s*year|12m)\b/, "12m"],
    [/\bthis\s*week\b/, "this_week"],
    [/\blast\s*week\b/, "last_week"],
    [/\bthis\s*month\b/, "this_month"],
    [/\blast\s*month\b/, "last_month"],
    [/\bthis\s*quarter\b/, "this_quarter"],
    [/\blast\s*quarter\b/, "last_quarter"],
    [/\bthis\s*year\b/, "this_year"],
    [/\blast\s*year\b/, "last_year"],
  ];
  for (const [pattern, period] of patterns) {
    if (pattern.test(q) && (VALID_PERIODS as readonly string[]).includes(period)) {
      return period;
    }
  }
  return DEFAULT_PERIOD;
}

function scoreReport(report: ReportDef, query: string): number {
  const q = query.toLowerCase();
  let score = 0;
  for (const keyword of report.keywords) {
    if (q.includes(keyword)) score += keyword.includes(" ") ? 3 : 2;
  }
  if (q.includes(report.key)) score += 3;
  return score;
}

function resultUrl(dashboardUrl: string, key: string, period: string): string {
  return `${dashboardUrl}/?report=${encodeURIComponent(key)}&period=${encodeURIComponent(period)}`;
}

export interface OpenAICompatContext {
  /** Set only when the connection resolves to exactly one site (DEC-09). */
  accountId?: string;
  dashboardUrl: string;
}

/** Site whose name, id or one of its domains is mentioned in the query. */
export function matchSites(sites: SiteInfo[], query: string): SiteInfo[] {
  const q = query.toLowerCase();
  return sites.filter((site) => {
    if (site.id.length >= 3 && q.includes(site.id.toLowerCase())) return true;
    if (site.name.length >= 3 && q.includes(site.name.toLowerCase())) return true;
    return (site.domains ?? []).some((domain) => {
      const bare = domain.toLowerCase().replace(/^www\./, "");
      return bare.length >= 3 && q.includes(bare);
    });
  });
}

/**
 * Parse a search/fetch id right-to-left into `{siteId?, report, period}`.
 * `site:<id>` is handled by the caller before this.
 */
export function parseReportId(id: string): { siteId?: string; key: string; period: string } {
  const parts = id.split(":");
  const period = parts.length > 1 ? parts[parts.length - 1] : DEFAULT_PERIOD;
  const key = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  const siteId = parts.length > 2 ? parts.slice(0, parts.length - 2).join(":") : undefined;
  return { siteId, key, period };
}

function siteResults(sites: SiteInfo[], dashboardUrl: string) {
  return sites.slice(0, MAX_SITE_RESULTS).map((site) => ({
    id: `${SITE_ID_PREFIX}${site.id}`,
    title: `${site.name} — ${(site.domains ?? []).join(", ") || site.id}`,
    url: `${dashboardUrl}/sites/${encodeURIComponent(site.id)}`,
  }));
}

function reportResults(
  reports: ReportDef[],
  period: string,
  dashboardUrl: string,
  siteId?: string,
) {
  const prefix = siteId ? `${siteId}:` : "";
  return reports.map((report) => ({
    id: `${prefix}${report.key}:${period}`,
    title: `${report.title} — ${period}`,
    url: resultUrl(dashboardUrl, report.key, period),
  }));
}

function rankReports(query: string): ReportDef[] {
  const scored = REPORTS.map((report) => ({ report, score: scoreReport(report, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.report);
  return scored.length > 0
    ? scored
    : REPORTS.filter((report) => DEFAULT_RESULTS.includes(report.key));
}

/** Build the ChatGPT-compat `search` + `fetch` tool defs for a connection. */
export function createOpenAICompatTools(ctx: OpenAICompatContext): ToolDef[] {
  const multiSite = !ctx.accountId;

  async function listSites(client: SealMetricsClient): Promise<SiteInfo[]> {
    // The per-grant api_key already limits this to the connection's sites.
    const data = await client.request<SiteListResponse>("/sites");
    return data.sites ?? [];
  }

  // search/fetch exist for clients that only speak this pair (ChatGPT); the
  // named report tools sit beside them and are the richer path.
  const searchTool: ToolDef = {
    name: "search",
    description: (multiSite
      ? "Search the available SealMetrics analytics reports across the sites this connection covers. A query that names a site (or its domain) returns that site's reports; otherwise the results are the list of sites. " +
        "Each result carries an id that retrieves the report. A time range in the query (e.g. 'last 7 days') scopes the reports."
      : "Search the available SealMetrics analytics reports for the connected site. " +
        "Returns report references, each with an id that retrieves the report. " +
        "A time range in the query (e.g. 'last 7 days') scopes the reports. No filters or period comparisons."),
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you want to know (e.g. 'conversions last month for myshop.com')." },
      },
      required: ["query"],
    },
    handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
      const query = String(args.query ?? "");
      const period = detectPeriod(query);
      if (!multiSite) {
        return { results: reportResults(rankReports(query), period, ctx.dashboardUrl) };
      }
      const sites = await listSites(client);
      const matches = matchSites(sites, query);
      if (matches.length === 1) {
        return {
          results: reportResults(rankReports(query), period, ctx.dashboardUrl, matches[0].id),
        };
      }
      // Ambiguous (or nothing named): hand back the SITES, never the reports of
      // all of them (DEC-04 reinforced). Narrow to the partial matches if any.
      return { results: siteResults(matches.length > 1 ? matches : sites, ctx.dashboardUrl) };
    },
  };

  const fetchTool: ToolDef = {
    name: "fetch",
    description:
      "Get a SealMetrics analytics report by its id. " +
      (multiSite
        ? "Id format: '<site_id>:<report>:<period>', e.g. 'myshop:overview:30d'. A 'site:<site_id>' id returns that site's details and the report ids available for it."
        : "Id format: '<report>:<period>', e.g. 'overview:30d'."),
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Report id, e.g. 'conversions:7d'." },
      },
      required: ["id"],
    },
    handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
      const id = String(args.id ?? "");

      // `site:<id>` — the user picked a site from an ambiguous search.
      if (id.startsWith(SITE_ID_PREFIX)) {
        const siteId = id.slice(SITE_ID_PREFIX.length);
        const sites = await listSites(client);
        const site = sites.find((entry) => entry.id === siteId);
        if (!site) {
          throw new Error(
            `Unknown site '${siteId}'. Run \`search\` again to list the sites this connection covers.`,
          );
        }
        const available = REPORTS.map((report) => `${site.id}:${report.key}:${DEFAULT_PERIOD}`);
        return {
          id,
          title: `${site.name} — ${(site.domains ?? []).join(", ") || site.id}`,
          text: JSON.stringify(
            { site_id: site.id, name: site.name, domains: site.domains, timezone: site.timezone, available_report_ids: available },
            null,
            2,
          ),
          url: `${ctx.dashboardUrl}/sites/${encodeURIComponent(site.id)}`,
          metadata: { site_id: site.id },
        };
      }

      const parsed = parseReportId(id);
      const report = REPORTS.find((entry) => entry.key === parsed.key);
      if (!report) {
        throw new Error(
          `Unknown report id '${id}'. Valid reports: ${REPORTS.map((r) => r.key).join(", ")}`,
        );
      }
      const siteId = parsed.siteId ?? ctx.accountId;
      if (!siteId) {
        throw new Error(
          `Report id '${id}' does not name a site and this connection covers several. Use '<site_id>:${report.key}:${parsed.period}' — run \`search\` to list the sites.`,
        );
      }
      const period = (VALID_PERIODS as readonly string[]).includes(parsed.period)
        ? parsed.period
        : DEFAULT_PERIOD;
      // `period` is passed through verbatim — the API resolves it in the
      // account's timezone (never pre-resolve presets client-side).
      const data = await client.requestDirect<unknown>(report.endpoint, {
        site_id: siteId,
        account_id: siteId,
        period,
        ...report.params,
      });
      let text = JSON.stringify(data, null, 2);
      if (text.length > MAX_TEXT_LENGTH) {
        text = text.slice(0, MAX_TEXT_LENGTH) + "\n... (truncated)";
      }
      const resultId = parsed.siteId
        ? `${siteId}:${report.key}:${period}`
        : `${report.key}:${period}`;
      return {
        id: resultId,
        title: `${report.title} — ${period}`,
        text,
        url: resultUrl(ctx.dashboardUrl, report.key, period),
        metadata: { site_id: siteId, period, endpoint: report.endpoint },
      };
    },
  };

  return [searchTool, fetchTool];
}
