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
  countryParam,
  LANDING_PAGE_SCHEMA,
} from "./shared.js";
import type { ToolDef } from "./index.js";

const TRAFFIC_SORT_BY = {
  type: "string",
  description: "Field to sort by.",
  enum: ["entrances", "engaged_entrances", "page_views", "conversions", "revenue", "bounce_rate"],
  default: "entrances",
} as const;

function trafficParams(args: Record<string, unknown>): Record<string, string | undefined> {
  return {
    site_id: resolveSiteId(args),
    ...dateRangeParams(args),
    compare: args.compare as string | undefined,
    page_size: String((args.limit as number) ?? 20),
    page: args.page != null ? String(args.page as number) : undefined,
    sort_by: (args.sort_by as string) ?? "entrances",
    sort_order: (args.sort_order as string) ?? "desc",
  };
}

export const getTrafficSourcesTool: ToolDef = {
  name: "get_traffic_sources",
  description:
    "Get traffic broken down by source (utm_source): google, facebook, twitter, direct, etc. Shows entrances, pageviews, conversions, and revenue per source.",
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
      page: PAGE_SCHEMA,
      sort_by: TRAFFIC_SORT_BY,
      sort_order: SORT_ORDER_SCHEMA,
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const params = trafficParams(args);
    params.country = countryParam(args);
    return client.requestPaginated("/stats/sources", params);
  },
};

export const getTrafficMediumsTool: ToolDef = {
  name: "get_traffic_mediums",
  description:
    "Get traffic broken down by medium (utm_medium): organic, cpc, email, referral, social, etc. Useful for understanding which marketing channels drive traffic.",
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
      page: PAGE_SCHEMA,
      sort_by: TRAFFIC_SORT_BY,
      sort_order: SORT_ORDER_SCHEMA,
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const params = trafficParams(args);
    params.country = countryParam(args);
    return client.requestPaginated("/stats/mediums", params);
  },
};

export const getCampaignsTool: ToolDef = {
  name: "get_campaigns",
  description:
    "Get traffic and conversions broken down by campaign (utm_campaign). Shows performance of individual marketing campaigns including entrances, conversions, and revenue.",
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
      page: PAGE_SCHEMA,
      sort_by: TRAFFIC_SORT_BY,
      sort_order: SORT_ORDER_SCHEMA,
      utm_source: {
        type: "string",
        description: "Filter by source (e.g. 'google').",
      },
      utm_medium: {
        type: "string",
        description: "Filter by medium (e.g. 'cpc').",
      },
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const params = trafficParams(args);
    params.utm_source = args.utm_source as string | undefined;
    params.utm_medium = args.utm_medium as string | undefined;
    params.country = countryParam(args);
    return client.requestPaginated("/stats/campaigns", params);
  },
};

export const getTermsTool: ToolDef = {
  name: "get_terms",
  description:
    "Get traffic and conversions broken down by UTM term (keyword). Shows which search keywords or ad terms drive the most traffic. Supports filtering by source, medium, and campaign.",
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
      page: PAGE_SCHEMA,
      sort_by: TRAFFIC_SORT_BY,
      sort_order: SORT_ORDER_SCHEMA,
      utm_source: {
        type: "string",
        description: "Filter by source (e.g. 'google').",
      },
      utm_medium: {
        type: "string",
        description: "Filter by medium (e.g. 'cpc').",
      },
      utm_campaign: {
        type: "string",
        description: "Filter by campaign name.",
      },
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const params = trafficParams(args);
    params.utm_source = args.utm_source as string | undefined;
    params.utm_medium = args.utm_medium as string | undefined;
    params.utm_campaign = args.utm_campaign as string | undefined;
    params.country = countryParam(args);
    return client.requestPaginated("/stats/terms", params);
  },
};

// --- Top N tools (non-paginated, client.request) ---

function topNParams(args: Record<string, unknown>): Record<string, string | undefined> {
  return {
    site_id: resolveSiteId(args),
    ...dateRangeParams(args),
    limit: String((args.limit as number) ?? 10),
  };
}

export const getTopSourcesTool: ToolDef = {
  name: "get_top_sources",
  description:
    "Get top traffic sources ranked by entrances. Returns a compact list of the top N sources (utm_source) without pagination — ideal for quick rankings and summaries. " +
    "Pass landing_page to see which sources brought the sessions that entered on one specific page.",
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
      utm_medium: {
        type: "string",
        description: "Filter by medium (e.g. 'cpc').",
      },
      country: COUNTRY_SCHEMA,
      landing_page: {
        ...LANDING_PAGE_SCHEMA,
        description:
          "Restrict to sessions that entered on this landing path (exact match). The result then comes from the landing-page report and has no page_views field.",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const params = topNParams(args);
    params.utm_medium = args.utm_medium as string | undefined;
    params.country = countryParam(args);
    params.landing_page = args.landing_page as string | undefined;
    return client.request<unknown>("/stats/sources/top", params);
  },
};

export const getTopCampaignsTool: ToolDef = {
  name: "get_top_campaigns",
  description:
    "Get top campaigns ranked by entrances. Returns a compact list of the top N campaigns (utm_campaign) — ideal for quick rankings.",
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
        description: "Filter by source (e.g. 'google').",
      },
      utm_medium: {
        type: "string",
        description: "Filter by medium (e.g. 'cpc').",
      },
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const params = topNParams(args);
    params.utm_source = args.utm_source as string | undefined;
    params.utm_medium = args.utm_medium as string | undefined;
    params.country = countryParam(args);
    return client.request<unknown>("/stats/campaigns/top", params);
  },
};

export const getTopTermsTool: ToolDef = {
  name: "get_top_terms",
  description:
    "Get top UTM terms (keywords) ranked by entrances. Returns a compact list of the top N terms — ideal for quick keyword rankings.",
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
        description: "Filter by source (e.g. 'google').",
      },
      utm_medium: {
        type: "string",
        description: "Filter by medium (e.g. 'cpc').",
      },
      utm_campaign: {
        type: "string",
        description: "Filter by campaign name.",
      },
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const params = topNParams(args);
    params.utm_source = args.utm_source as string | undefined;
    params.utm_medium = args.utm_medium as string | undefined;
    params.utm_campaign = args.utm_campaign as string | undefined;
    params.country = countryParam(args);
    return client.request<unknown>("/stats/terms/top", params);
  },
};

export const getTopReferrersTool: ToolDef = {
  name: "get_top_referrers",
  description:
    "Get top referrer domains ranked by entrances. Shows which external sites send the most traffic.",
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
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const params = topNParams(args);
    params.country = countryParam(args);
    return client.request<unknown>("/stats/referrers/top", params);
  },
};
