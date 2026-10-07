import type { SealMetricsClient } from "../client.js";
import type { FunnelReport } from "../types.js";
import {
  PERIOD_SCHEMA,
  START_DATE_SCHEMA,
  END_DATE_SCHEMA,
  dateRangeParams,
  resolveSiteId,
  countryParam,
  COUNTRY_SCHEMA,
  SITE_ID_SCHEMA,
} from "./shared.js";
import type { ToolDef } from "./index.js";

/** Rows per call. The API allows 10,000 (CSV export); a model cannot digest that. */
const FUNNEL_DEFAULT_LIMIT = 100;
const FUNNEL_MAX_LIMIT = 500;

const UTM_FILTER_ARGS = ["utm_source", "utm_medium", "utm_campaign"] as const;

/**
 * Named UTM arguments -> the API `filters` string (`field:eq:value,...`). The
 * API splits that string on "," and ":" only for the first two separators, so
 * a comma inside a value would silently split into a different filter.
 */
function funnelFilters(args: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const field of UTM_FILTER_ARGS) {
    const value = args[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") throw new Error(`${field} must be a string`);
    if (value.includes(",")) {
      throw new Error(`${field} cannot contain a comma; filter on a shorter exact value`);
    }
    parts.push(`${field}:eq:${value}`);
  }
  return parts.length ? parts.join(",") : undefined;
}

function funnelLimit(args: Record<string, unknown>): string {
  const raw = Number(args.limit ?? FUNNEL_DEFAULT_LIMIT);
  const limit = Number.isFinite(raw) ? Math.trunc(raw) : FUNNEL_DEFAULT_LIMIT;
  return String(Math.min(Math.max(limit, 1), FUNNEL_MAX_LIMIT));
}

export const getFunnelTool: ToolDef = {
  name: "get_funnel",
  description:
    "Get the funnel table broken down by UTM source/medium/campaign/term: per row, entrances, page_views, and counts of each microconversion type and conversion type plus revenue per conversion type, with period totals and the list of types seen. " +
    "The counts are independent aggregates, not a sequential funnel: a row can show more conversions than add_to_cart events, and ratios between columns are not per-session dropoff. " +
    "Ratios computed from it are aggregate ratios. " +
    "Rows are the top `limit` UTM combinations by entrances (default 100, max 500); `truncated: true` means more exist, so a small source may be missing: " +
    "the utm_source / utm_medium / utm_campaign filters (exact match, case-insensitive) narrow the rows. `totals` always cover the whole filtered period.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      country: COUNTRY_SCHEMA,
      utm_source: {
        type: "string",
        description: "Only rows with this UTM source (exact match, case-insensitive), e.g. 'seedtag'.",
      },
      utm_medium: {
        type: "string",
        description: "Only rows with this UTM medium (exact match, case-insensitive), e.g. 'cpc'.",
      },
      utm_campaign: {
        type: "string",
        description: "Only rows with this UTM campaign (exact match, case-insensitive).",
      },
      limit: {
        type: "number",
        description: "Maximum number of UTM rows, top by entrances (default: 100, max: 500).",
        default: FUNNEL_DEFAULT_LIMIT,
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    // GET /stats/funnel answers with FunnelResponse itself, not the APIResponse envelope.
    return client.requestDirect<FunnelReport>("/stats/funnel", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      country: countryParam(args),
      filters: funnelFilters(args),
      limit: funnelLimit(args),
    });
  },
};
