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
  LANDING_PAGE_ARRAY_SCHEMA,
  SITE_ID_SCHEMA,
} from "./shared.js";
import type { ToolDef } from "./index.js";

export const getConversionsTool: ToolDef = {
  name: "get_conversions",
  description:
    "Get conversions broken down by type (e.g. purchase, signup). Shows count, revenue, and average order value per conversion type. " +
    "Use for aggregated counts/revenue by conversion type. " +
    "**For per-event detail or per-product analysis use `get_conversions_raw` or `get_conversion_items_raw`.**",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      compare: COMPARE_SCHEMA,
      limit: LIMIT_SCHEMA,
      sort_by: {
        type: "string",
        description: "Field to sort by.",
        enum: ["count", "revenue", "avg_value"],
        default: "count",
      },
      sort_order: SORT_ORDER_SCHEMA,
      page: PAGE_SCHEMA,
      utm_source: {
        type: "string",
        description: "Filter by traffic source.",
      },
      utm_medium: {
        type: "string",
        description: "Filter by traffic medium.",
      },
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/conversions", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      compare: args.compare as string | undefined,
      page_size: String((args.limit as number) ?? 20),
      page: args.page != null ? String(args.page as number) : undefined,
      sort_by: (args.sort_by as string) ?? "count",
      sort_order: (args.sort_order as string) ?? "desc",
      utm_source: args.utm_source as string | undefined,
      utm_medium: args.utm_medium as string | undefined,
      country: countryParam(args),
    });
  },
};

export const getMicroconversionsTool: ToolDef = {
  name: "get_microconversions",
  description:
    "Get microconversions (smaller engagement events) broken down by type: add_to_cart, newsletter_signup, pdf_download, etc. Shows count and trends per event type. " +
    "**For per-event detail use `get_microconversions_raw`.**",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      compare: COMPARE_SCHEMA,
      limit: LIMIT_SCHEMA,
      sort_by: {
        type: "string",
        description: "Field to sort by.",
        enum: ["count", "revenue", "avg_value"],
        default: "count",
      },
      sort_order: SORT_ORDER_SCHEMA,
      page: PAGE_SCHEMA,
      conversion_type: {
        type: "string",
        description: "Filter by specific microconversion type.",
      },
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/microconversions", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      compare: args.compare as string | undefined,
      page_size: String((args.limit as number) ?? 20),
      page: args.page != null ? String(args.page as number) : undefined,
      sort_by: (args.sort_by as string) ?? "count",
      sort_order: (args.sort_order as string) ?? "desc",
      conversion_type: args.conversion_type as string | undefined,
      country: countryParam(args),
    });
  },
};

export const listMicroconversionTypesTool: ToolDef = {
  name: "list_microconversion_types",
  description:
    "Get the list of available microconversion type names for a site. Use this to discover what microconversion types exist before querying details.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/stats/microconversions-types", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
    });
  },
};

export const getMicroconversionDetailsTool: ToolDef = {
  name: "get_microconversion_details",
  description:
    "Get detailed breakdown for a specific microconversion type. Shows metrics segmented by source, medium, campaign, country, device, browser, and OS.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      conversion_type: {
        type: "string",
        description: "The microconversion type to get details for (e.g. 'add_to_cart', 'newsletter_signup').",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      utm_source: {
        type: "string",
        description: "Filter by UTM source, one value or a list.",
      },
      utm_medium: {
        type: "string",
        description: "Filter by UTM medium, one value or a list.",
      },
      utm_campaign: {
        type: "string",
        description: "Filter by UTM campaign, one value or a list.",
      },
      utm_term: {
        type: "string",
        description: "Filter by UTM term, one value or a list.",
      },
      country: COUNTRY_SCHEMA,
      device_type: {
        type: "string",
        description: "Filter by device type (e.g. 'desktop', 'mobile', 'tablet').",
      },
      browser: {
        type: "string",
        description: "Filter by browser name.",
      },
      os: {
        type: "string",
        description: "Filter by operating system name.",
      },
    },
    required: ["conversion_type"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const conversionType = args.conversion_type as string;
    return client.request<unknown>(`/stats/microconversions/${encodeURIComponent(conversionType)}`, {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      utm_source: args.utm_source as string | undefined,
      utm_medium: args.utm_medium as string | undefined,
      utm_campaign: args.utm_campaign as string | undefined,
      utm_term: args.utm_term as string | undefined,
      country: countryParam(args),
      device_type: args.device_type as string | undefined,
      browser: args.browser as string | undefined,
      os: args.os as string | undefined,
    });
  },
};

// =============================================================================
// Raw event-level tools (PRD 08 — extends PRD 03 raw endpoints to MCP).
// =============================================================================
//
// LLM context budget guardrails:
// - `limit` capped at 100 (API allows up to 10000 — we cap to avoid burning
//   tokens). Validated by JSON Schema; oversized requests fail before reaching
//   the API.
// - `include_properties` defaults to false on conversions/microconversions —
//   custom properties are noisy metadata that rarely help answer questions.
//   Pass `include_properties=true` to receive the full `properties` object.
// - `get_conversion_items_raw` always returns properties (sku/price/qty live there).

const RAW_LIMIT_SCHEMA = {
  type: "number",
  description:
    "Maximum number of rows to return (default: 10, max: 100; larger values are capped at 100).",
  default: 10,
  minimum: 1,
  maximum: 100,
} as const;

/** The API allows far larger pages; the MCP keeps raw rows to 100 per call. */
function rawLimit(args: Record<string, unknown>): number {
  const requested = typeof args.limit === "number" ? Math.floor(args.limit) : 10;
  return Math.min(Math.max(requested, 1), 100);
}

const RAW_FILTER_KEYS = [
  "conversion_type",
  "country",
  "device_type",
  "browser",
  "os",
  "channel_group",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "landing_page",
] as const;

function pickRawFilters(
  args: Record<string, unknown>,
): Record<string, string[] | undefined> {
  const out: Record<string, string[] | undefined> = {};
  for (const key of RAW_FILTER_KEYS) {
    const value = args[key];
    // `string | string[]` (RF-034): a model filtering by one value should not
    // have to remember to wrap it in a list.
    if (typeof value === "string" && value !== "") {
      out[key] = [value];
    } else if (Array.isArray(value) && value.length > 0) {
      out[key] = value as string[];
    }
  }
  // Same country contract as everywhere else (PRD-062 RF-031).
  const country = countryListParam(args);
  if (country) out.country = country;
  return out;
}

const RAW_DATE_SCHEMA = {
  period: PERIOD_SCHEMA,
  start_date: {
    ...START_DATE_SCHEMA,
    description: `${START_DATE_SCHEMA.description} Raw endpoints reject ranges longer than 31 days.`,
  },
  end_date: END_DATE_SCHEMA,
} as const;

const RAW_MULTI_FILTER_SCHEMA = {
  conversion_type: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by conversion type, one value or a list (e.g. 'purchase')."
  },
  country: COUNTRY_ARRAY_SCHEMA,
  device_type: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by device type, one value or a list (e.g. 'mobile')."
  },
  browser: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by browser, one value or a list."
  },
  os: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by operating system, one value or a list."
  },
  channel_group: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by channel group, one value or a list."
  },
  utm_source: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by UTM source, one value or a list."
  },
  utm_medium: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by UTM medium, one value or a list."
  },
  utm_campaign: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by UTM campaign, one value or a list."
  },
  utm_term: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by UTM term, one value or a list."
  },
  utm_content: {
    anyOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
    description: "Filter by UTM content, one value or a list."
  },
  landing_page: LANDING_PAGE_ARRAY_SCHEMA,
} as const;

interface RawRow {
  properties?: unknown;
  [key: string]: unknown;
}

interface RawPaginated {
  data: RawRow[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
  comparison?: unknown;
  totals?: unknown;
}

function stripProperties(result: RawPaginated): RawPaginated {
  return {
    ...result,
    data: result.data.map((row) => {
      const { properties: _omit, ...rest } = row;
      return rest as RawRow;
    }),
  };
}

export const getConversionsRawTool: ToolDef = {
  name: "get_conversions_raw",
  description:
    "Returns raw conversion rows from /stats/conversions/raw (one row per event, with timestamp_utc and timestamp_local). " +
    "Use for one-row-per-event detail. " +
    "**For per-product/SKU analysis prefer `get_conversion_items_raw` (always includes item properties like sku, price, quantity).** " +
    "Custom `properties` are excluded by default — pass `include_properties=true` to receive them. " +
    "Ranges longer than 31 days are rejected: use a period of 31 days or less (e.g. today, yesterday, 7d, 30d, last_week, last_month) or start_date/end_date. `limit` defaults to 10 and is capped at 100 rows; use `page` for more.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      ...RAW_DATE_SCHEMA,
      page: PAGE_SCHEMA,
      limit: RAW_LIMIT_SCHEMA,
      include_properties: {
        type: "boolean",
        description:
          "If true, include the custom `properties` object in each row. Default false to keep responses compact.",
        default: false,
      },
      ...RAW_MULTI_FILTER_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const limit = rawLimit(args);
    const includeProperties = args.include_properties === true;
    const dates = dateRangeParams(args);
    const result = await client.requestPaginated<RawRow>("/stats/conversions/raw", {
      site_id: resolveSiteId(args),
      ...dates,
      page_size: String(limit),
      page: args.page != null ? String(args.page as number) : undefined,
      ...pickRawFilters(args),
    });
    return includeProperties ? result : stripProperties(result);
  },
};

export const getMicroconversionsRawTool: ToolDef = {
  name: "get_microconversions_raw",
  description:
    "Returns raw microconversion rows from /stats/microconversions/raw (one row per event, with timestamp_utc and timestamp_local). " +
    "Use for one-row-per-event detail of microconversions (add_to_cart, newsletter_signup, etc.). " +
    "Custom `properties` are excluded by default — pass `include_properties=true` to receive them. " +
    "Ranges longer than 31 days are rejected: use a period of 31 days or less (e.g. today, yesterday, 7d, 30d, last_week, last_month) or start_date/end_date. `limit` defaults to 10 and is capped at 100 rows; use `page` for more.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      ...RAW_DATE_SCHEMA,
      page: PAGE_SCHEMA,
      limit: RAW_LIMIT_SCHEMA,
      include_properties: {
        type: "boolean",
        description:
          "If true, include the custom `properties` object in each row. Default false to keep responses compact.",
        default: false,
      },
      ...RAW_MULTI_FILTER_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const limit = rawLimit(args);
    const includeProperties = args.include_properties === true;
    const dates = dateRangeParams(args);
    const result = await client.requestPaginated<RawRow>("/stats/microconversions/raw", {
      site_id: resolveSiteId(args),
      ...dates,
      page_size: String(limit),
      page: args.page != null ? String(args.page as number) : undefined,
      ...pickRawFilters(args),
    });
    return includeProperties ? result : stripProperties(result);
  },
};

export const getConversionItemsRawTool: ToolDef = {
  name: "get_conversion_items_raw",
  description:
    "Returns one row per item inside a conversion (e.g. one row per product in a purchase) from /stats/conversion-items/raw. " +
    "`properties` always included — that's where product_id, sku, price, quantity live. " +
    "**Best tool for per-product analytics.** " +
    "Ranges longer than 31 days are rejected: use a period of 31 days or less (e.g. today, yesterday, 7d, 30d, last_week, last_month) or start_date/end_date. `limit` defaults to 10 and is capped at 100 rows; use `page` for more.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      ...RAW_DATE_SCHEMA,
      page: PAGE_SCHEMA,
      limit: RAW_LIMIT_SCHEMA,
      ...RAW_MULTI_FILTER_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const limit = rawLimit(args);
    const dates = dateRangeParams(args);
    return client.requestPaginated<RawRow>("/stats/conversion-items/raw", {
      site_id: resolveSiteId(args),
      ...dates,
      page_size: String(limit),
      page: args.page != null ? String(args.page as number) : undefined,
      ...pickRawFilters(args),
    });
  },
};
