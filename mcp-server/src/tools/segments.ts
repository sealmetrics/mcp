import type { SealMetricsClient } from "../client.js";
import { resolveSiteId, SITE_ID_SCHEMA } from "./shared.js";
import type { ToolDef } from "./index.js";

export const listSegmentsTool: ToolDef = {
  name: "list_segments",
  description:
    "List all segments available for a site. Segments are saved filter sets (e.g. 'Mobile users from Spain', 'Organic traffic') defined in the dashboard. Reports here take no segment argument: a segment is reproduced by applying its filters as the named arguments the reports do accept (country, device_type, channel_group, utm_*).",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      include_system: {
        type: "boolean",
        description: "Include system segments like 'All Traffic', 'Direct' (default: true).",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/segments", {
      account_id: resolveSiteId(args),
      include_system: args.include_system != null ? String(args.include_system) : undefined,
    });
  },
};

export const getSegmentTool: ToolDef = {
  name: "get_segment",
  description:
    "Get one segment's definition: id, name, display name, description and its filter conditions. Returns no traffic or conversion metrics. The segment_id can be either the segment ID (seg_xxx) or the segment name.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      segment_id: {
        type: "string",
        description: "Segment ID (seg_xxx) or segment name.",
      },
    },
    required: ["segment_id"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const segmentId = args.segment_id as string;
    return client.request<unknown>(`/segments/${encodeURIComponent(segmentId)}`, {
      account_id: resolveSiteId(args),
    });
  },
};
