import type { SealMetricsClient } from "../client.js";
import {
  PERIOD_SCHEMA,
  START_DATE_SCHEMA,
  END_DATE_SCHEMA,
  dateRangeParams,
  resolveSiteId,
  COUNTRY_SCHEMA,
  countryParam,
  SITE_ID_SCHEMA,
} from "./shared.js";
import type { ToolDef } from "./index.js";

export const getContentGroupsTool: ToolDef = {
  name: "get_content_groups",
  description:
    "Get metrics grouped by content group (content_grouping). Shows pageviews and entrances per content group. Useful for understanding which sections of a site get the most traffic.",
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
        description: "Filter by UTM source (e.g. 'google').",
      },
      utm_medium: {
        type: "string",
        description: "Filter by UTM medium (e.g. 'cpc').",
      },
      utm_campaign: {
        type: "string",
        description: "Filter by UTM campaign name.",
      },
      utm_term: {
        type: "string",
        description: "Filter by UTM term.",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/stats/pages/content-groups", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      country: countryParam(args),
      utm_source: args.utm_source as string | undefined,
      utm_medium: args.utm_medium as string | undefined,
      utm_campaign: args.utm_campaign as string | undefined,
      utm_term: args.utm_term as string | undefined,
    });
  },
};
