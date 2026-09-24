import type { SealMetricsClient } from "../client.js";
import {
  PERIOD_SCHEMA,
  COMPARE_SCHEMA,
  LIMIT_SCHEMA,
  SORT_ORDER_SCHEMA,
  PAGE_SCHEMA,
  resolveSiteId,
  START_DATE_SCHEMA,
  END_DATE_SCHEMA,
  dateRangeParams,
  COUNTRY_SCHEMA,
  COUNTRY_ARRAY_SCHEMA,
  countryParam,
  countryListParam,
} from "./shared.js";
import type { ToolDef } from "./index.js";

// Common multi-value filter and `include` schema for /stats/pages and /stats/landing-pages.
// Mirrors the API parameters declared in routers/stats.py (PRD 03).
const MULTI_FILTER_SCHEMA = {
  country: COUNTRY_ARRAY_SCHEMA,
  device_type: {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
    description: "Filter by device type(s) (e.g. ['mobile', 'desktop']).",
  },
  browser: {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
    description: "Filter by browser name(s).",
  },
  os: {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
    description: "Filter by operating system name(s).",
  },
  channel_group: {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
    description: "Filter by channel group(s).",
  },
  utm_source: {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
    description: "Filter by UTM source(s).",
  },
  utm_medium: {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
    description: "Filter by UTM medium(s).",
  },
  utm_campaign: {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
    description: "Filter by UTM campaign(s).",
  },
  utm_term: {
    type: "array",
    items: { type: "string", minLength: 1 },
    minItems: 1,
    description: "Filter by UTM term(s).",
  },
  // `minItems` intentionally absent — empty array ≡ no grouping (PRD 08
  // VAL-006 exception). Filter arrays use minItems: 1 because an empty
  // filter list would silently match nothing; `include` instead is a no-op
  // when empty, matching the API behavior.
  include: {
    type: "array",
    items: { type: "string", enum: ["device", "browser", "os", "channel_group"] },
    description:
      "Add dimension(s) to GROUP BY and response. Allowed values: device, browser, os, channel_group. Empty/absent means no extra grouping.",
  },
} as const;

const MULTI_FILTER_KEYS = [
  "country",
  "device_type",
  "browser",
  "os",
  "channel_group",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "include",
] as const;

function pickMultiFilters(
  args: Record<string, unknown>,
): Record<string, string[] | undefined> {
  const out: Record<string, string[] | undefined> = {};
  for (const key of MULTI_FILTER_KEYS) {
    const value = args[key];
    if (Array.isArray(value) && value.length > 0) {
      out[key] = value as string[];
    }
  }
  // Country goes through the shared check so a name never reaches the API
  // (PRD-062 RF-031); it also normalizes `unknown` to the pixel's literal.
  const country = countryListParam(args);
  if (country) out.country = country;
  return out;
}

export const getPagesTool: ToolDef = {
  name: "get_pages",
  description:
    "Get metrics per page URL path: pageviews and entrances. Useful for finding most popular pages and content performance. " +
    "For bounce rate by entry page, use get_landing_pages instead — bounce is not interpretable at page granularity. " +
    "Supports multi-value filters (country, device_type, browser, os, channel_group, UTMs) as arrays of strings — e.g. " +
    "device_type=['mobile'] to filter to mobile only. Pass include=['device'] to also break down metrics by device. " +
    "The two are orthogonal — combine them as needed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID. Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      compare: COMPARE_SCHEMA,
      limit: LIMIT_SCHEMA,
      sort_by: {
        type: "string",
        description: "Field to sort by.",
        enum: ["page_views", "entrances"],
        default: "page_views",
      },
      sort_order: SORT_ORDER_SCHEMA,
      page: PAGE_SCHEMA,
      path_filter: {
        type: "string",
        description: "Filter pages by URL path pattern (e.g. '/blog').",
      },
      ...MULTI_FILTER_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/pages", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      compare: args.compare as string | undefined,
      page_size: String((args.limit as number) ?? 20),
      page: args.page != null ? String(args.page as number) : undefined,
      sort_by: (args.sort_by as string) ?? "page_views",
      sort_order: (args.sort_order as string) ?? "desc",
      path_filter: args.path_filter as string | undefined,
      ...pickMultiFilters(args),
    });
  },
};

export const getLandingPagesTool: ToolDef = {
  name: "get_landing_pages",
  description:
    "Get landing page performance: entrances, bounce rate, conversions. Landing pages are the first page users see when entering the site. High bounce rates indicate poor landing page experience. " +
    "Supports multi-value filters (country, device_type, browser, os, channel_group, UTMs) as arrays of strings — e.g. " +
    "country=['ES','PT'] to filter to two countries. Pass include=['channel_group'] to also break down by channel group. " +
    "The two are orthogonal — combine them as needed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID. Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      compare: COMPARE_SCHEMA,
      limit: LIMIT_SCHEMA,
      sort_by: {
        type: "string",
        description: "Field to sort by.",
        enum: ["entrances", "engaged_entrances", "page_views", "conversions", "revenue", "bounce_rate"],
        default: "entrances",
      },
      sort_order: SORT_ORDER_SCHEMA,
      page: PAGE_SCHEMA,
      path_filter: {
        type: "string",
        description: "Filter by URL path pattern.",
      },
      ...MULTI_FILTER_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/landing-pages", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      compare: args.compare as string | undefined,
      page_size: String((args.limit as number) ?? 20),
      page: args.page != null ? String(args.page as number) : undefined,
      sort_by: (args.sort_by as string) ?? "entrances",
      sort_order: (args.sort_order as string) ?? "desc",
      path_filter: args.path_filter as string | undefined,
      ...pickMultiFilters(args),
    });
  },
};

// --- Top N tools (non-paginated, client.request) ---

export const getTopPagesTool: ToolDef = {
  name: "get_top_pages",
  description:
    "Get top pages ranked by page views. Returns a compact list of the top N pages — ideal for quick rankings and summaries.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID. Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      limit: LIMIT_SCHEMA,
      country: COUNTRY_SCHEMA,
      utm_source: {
        type: "string",
        description: "Filter by UTM source.",
      },
      utm_medium: {
        type: "string",
        description: "Filter by UTM medium.",
      },
      utm_campaign: {
        type: "string",
        description: "Filter by UTM campaign.",
      },
      utm_term: {
        type: "string",
        description: "Filter by UTM term.",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/stats/pages/top", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      limit: String((args.limit as number) ?? 10),
      country: countryParam(args),
      utm_source: args.utm_source as string | undefined,
      utm_medium: args.utm_medium as string | undefined,
      utm_campaign: args.utm_campaign as string | undefined,
      utm_term: args.utm_term as string | undefined,
    });
  },
};

export const getTopLandingPagesTool: ToolDef = {
  name: "get_top_landing_pages",
  description:
    "Get top landing pages ranked by entrances. Returns a compact list of the top N landing pages — ideal for quick rankings.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID. Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      limit: LIMIT_SCHEMA,
      utm_source: {
        type: "string",
        description: "Filter by UTM source.",
      },
      utm_medium: {
        type: "string",
        description: "Filter by UTM medium.",
      },
      country: COUNTRY_SCHEMA,
      content_grouping: {
        type: "string",
        description: "Filter by content grouping name.",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/stats/landing-pages/top", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      limit: String((args.limit as number) ?? 10),
      utm_source: args.utm_source as string | undefined,
      utm_medium: args.utm_medium as string | undefined,
      country: countryParam(args),
      content_grouping: args.content_grouping as string | undefined,
    });
  },
};

export const getLandingPagesByContentGroupTool: ToolDef = {
  name: "get_landing_pages_by_content_group",
  description:
    "Get landing page metrics grouped by content grouping. Shows aggregate performance per content group (e.g. blog, product, category).",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID. Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      utm_source: {
        type: "string",
        description: "Filter by UTM source.",
      },
      utm_medium: {
        type: "string",
        description: "Filter by UTM medium.",
      },
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/stats/landing-pages/by-content-group", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      utm_source: args.utm_source as string | undefined,
      utm_medium: args.utm_medium as string | undefined,
      country: countryParam(args),
    });
  },
};
