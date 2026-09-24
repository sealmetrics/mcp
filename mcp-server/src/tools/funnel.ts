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
} from "./shared.js";
import type { ToolDef } from "./index.js";

export const getFunnelTool: ToolDef = {
  name: "get_funnel",
  description:
    "Get funnel analysis showing conversion rates between steps. Returns step-by-step data including visitor count, conversion rate, and dropoff at each stage. Useful for finding where users drop off in multi-step flows.",
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
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<FunnelReport>("/stats/funnel", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      country: countryParam(args),
    });
  },
};
