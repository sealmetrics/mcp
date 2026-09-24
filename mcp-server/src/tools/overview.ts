import type { SealMetricsClient } from "../client.js";
import type { StatsOverview } from "../types.js";
import {
  PERIOD_SCHEMA,
  COMPARE_SCHEMA,
  START_DATE_SCHEMA,
  END_DATE_SCHEMA,
  dateRangeParams,
  resolveSiteId,
  COUNTRY_ARRAY_SCHEMA,
  countryListParam,
} from "./shared.js";
import type { ToolDef } from "./index.js";

export const getOverviewTool: ToolDef = {
  name: "get_overview",
  description:
    "Get dashboard KPIs: pageviews, entrances, bounce rate, conversions, revenue. Includes time series data and optional period-over-period comparison. This is the best starting point for understanding a site's performance.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description:
          "Site ID. Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      compare: COMPARE_SCHEMA,
      country: COUNTRY_ARRAY_SCHEMA,
    },
  },
  handler: async (
    client: SealMetricsClient,
    args: Record<string, unknown>,
  ) => {
    const siteId = resolveSiteId(args);
    const params: Record<string, string | string[] | undefined> = {
      site_id: siteId,
      ...dateRangeParams(args),
      compare: args.compare as string | undefined,
      country: countryListParam(args),
    };
    return client.request<StatsOverview>("/stats/overview", params);
  },
};
