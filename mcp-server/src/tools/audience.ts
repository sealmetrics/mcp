import type { SealMetricsClient } from "../client.js";
import type { DevicesBreakdown } from "../types.js";
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
  SITE_ID_SCHEMA,
} from "./shared.js";
import type { ToolDef } from "./index.js";

export const getCountriesTool: ToolDef = {
  name: "get_countries",
  description:
    "Get traffic broken down by country. Shows entrances, pageviews, conversions, and revenue per country. Country codes follow ISO 3166-1 alpha-2 (e.g. ES=Spain, US=United States); 'Unknown' is a real bucket for browsers whose timezone maps to no country. Country is derived from the browser's timezone, not the IP address, so treat splits as directional. The codes returned here are the values other tools accept in their `country` filter.",
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
        enum: ["entrances", "engaged_entrances", "page_views", "conversions", "revenue", "bounce_rate"],
        default: "entrances",
      },
      sort_order: SORT_ORDER_SCHEMA,
      page: PAGE_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/geo/countries", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      compare: args.compare as string | undefined,
      page_size: String((args.limit as number) ?? 20),
      page: args.page != null ? String(args.page as number) : undefined,
      sort_by: (args.sort_by as string) ?? "entrances",
      sort_order: (args.sort_order as string) ?? "desc",
    });
  },
};

export const getDevicesTool: ToolDef = {
  name: "get_devices",
  description:
    "Get traffic broken down by device type (desktop/mobile/tablet), browser (Chrome, Safari, Firefox...), and operating system (Windows, macOS, iOS, Android...). Returns all three breakdowns in a single call.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      compare: COMPARE_SCHEMA,
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<DevicesBreakdown>("/stats/devices", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      compare: args.compare as string | undefined,
      country: countryParam(args),
    });
  },
};

export const getBrowsersTool: ToolDef = {
  name: "get_browsers",
  description:
    "Get traffic broken down by browser: Chrome, Safari, Firefox, Edge, etc. Shows entrances and pageviews per browser with pagination.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      limit: LIMIT_SCHEMA,
      page: PAGE_SCHEMA,
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/browsers", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      page_size: String((args.limit as number) ?? 20),
      page: args.page != null ? String(args.page as number) : undefined,
      country: countryParam(args),
    });
  },
};

export const getOperatingSystemsTool: ToolDef = {
  name: "get_operating_systems",
  description:
    "Get traffic broken down by operating system: Windows, macOS, iOS, Android, Linux, etc. Shows entrances and pageviews per OS with pagination.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      limit: LIMIT_SCHEMA,
      page: PAGE_SCHEMA,
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/operating-systems", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      page_size: String((args.limit as number) ?? 20),
      page: args.page != null ? String(args.page as number) : undefined,
      country: countryParam(args),
    });
  },
};

export const getDeviceTypesTool: ToolDef = {
  name: "get_device_types",
  description:
    "Get traffic broken down by device type (desktop, mobile, tablet) with pagination. Shows entrances, pageviews, conversions per device type.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      limit: LIMIT_SCHEMA,
      page: PAGE_SCHEMA,
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestPaginated("/stats/devices/types", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      page_size: String((args.limit as number) ?? 10),
      page: args.page != null ? String(args.page as number) : undefined,
      country: countryParam(args),
    });
  },
};
