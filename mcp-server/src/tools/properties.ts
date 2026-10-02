import type { SealMetricsClient } from "../client.js";
import {
  PERIOD_SCHEMA,
  LIMIT_SCHEMA,
  PAGE_SCHEMA,
  resolveSiteId,
  START_DATE_SCHEMA,
  END_DATE_SCHEMA,
  dateRangeParams,
  SITE_ID_SCHEMA,
} from "./shared.js";
import type { ToolDef } from "./index.js";

const TABLE_SCHEMA = {
  type: "string",
  description:
    'Table to query: "conversions", "microconversions", "both", or "conversion_items". Default: "both".',
  enum: ["conversions", "microconversions", "both", "conversion_items"],
  default: "both",
} as const;

export const listPropertyKeysTool: ToolDef = {
  name: "list_property_keys",
  description:
    "Get the list of available custom property keys from conversions and/or microconversions. Use this to discover what property keys exist before querying values or breakdowns.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      table: TABLE_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/stats/properties/keys", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      table: (args.table as string) ?? "both",
    });
  },
};

export const getPropertyValuesTool: ToolDef = {
  name: "get_property_values",
  description:
    "Get property values with counts, grouped by a UTM parameter. Paginated. Use to see which values a specific property key has and how they distribute across traffic sources.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      property_key: {
        type: "string",
        description: "The property key to analyze (e.g. 'product_name', 'plan_type').",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      group_by: {
        type: "string",
        description:
          'Group results by: "utm_source", "utm_medium", "utm_campaign", or "all". Default: "utm_source".',
        enum: ["utm_source", "utm_medium", "utm_campaign", "all"],
        default: "utm_source",
      },
      table: TABLE_SCHEMA,
      conversion_type: {
        type: "string",
        description: "Filter by conversion type.",
      },
      limit: LIMIT_SCHEMA,
      page: PAGE_SCHEMA,
    },
    required: ["property_key"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/properties/values", {
      site_id: resolveSiteId(args),
      property_key: args.property_key as string,
      ...dateRangeParams(args),
      group_by: (args.group_by as string) ?? "utm_source",
      table: (args.table as string) ?? "both",
      conversion_type: args.conversion_type as string | undefined,
      page_size: String((args.limit as number) ?? 50),
      page: args.page != null ? String(args.page as number) : undefined,
    });
  },
};

export const getPropertyBreakdownTool: ToolDef = {
  name: "get_property_breakdown",
  description:
    "Get a complete property breakdown with pivot-table style data. Shows all values for a property key with their counts and revenue — ideal for analyzing product or category performance.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      property_key: {
        type: "string",
        description: "The property key to analyze (e.g. 'product_name', 'plan_type').",
      },
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      table: TABLE_SCHEMA,
      conversion_type: {
        type: "string",
        description: "Filter by conversion type.",
      },
    },
    required: ["property_key"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/stats/properties/breakdown", {
      site_id: resolveSiteId(args),
      property_key: args.property_key as string,
      ...dateRangeParams(args),
      table: (args.table as string) ?? "both",
      conversion_type: args.conversion_type as string | undefined,
    });
  },
};
