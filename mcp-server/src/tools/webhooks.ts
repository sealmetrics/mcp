import type { SealMetricsClient } from "../client.js";
import { LIMIT_SCHEMA, resolveSiteId, SITE_ID_SCHEMA } from "./shared.js";
import type { ToolDef } from "./index.js";

export const listWebhooksTool: ToolDef = {
  name: "list_webhooks",
  description:
    "List webhook endpoints configured for a site. Shows endpoint URL, subscribed event types, and active status. Webhooks send real-time HTTP notifications when events occur.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      include_inactive: {
        type: "boolean",
        description: "Include inactive webhook endpoints (default: false).",
      },
      limit: LIMIT_SCHEMA,
      offset: {
        type: "number",
        description: "Offset for pagination (default: 0).",
        default: 0,
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestDirect<unknown>("/webhooks", {
      account_id: resolveSiteId(args),
      include_inactive: args.include_inactive != null ? String(args.include_inactive) : undefined,
      limit: String((args.limit as number) ?? 50),
      offset: args.offset != null ? String(args.offset as number) : undefined,
    });
  },
};

export const listWebhookDeliveriesTool: ToolDef = {
  name: "list_webhook_deliveries",
  description:
    "List delivery attempts for a specific webhook endpoint. Shows HTTP status, response time, and success/failure for each delivery. Useful for debugging webhook integration issues.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      endpoint_id: {
        type: "string",
        description: "Webhook endpoint UUID.",
      },
      status: {
        type: "string",
        description: "Filter by delivery status.",
        enum: ["pending", "success", "failed"],
      },
      limit: LIMIT_SCHEMA,
      offset: {
        type: "number",
        description: "Offset for pagination (default: 0).",
        default: 0,
      },
    },
    required: ["endpoint_id"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const endpointId = args.endpoint_id as string;
    return client.requestDirect<unknown>(`/webhooks/${encodeURIComponent(endpointId)}/deliveries`, {
      account_id: resolveSiteId(args),
      status: args.status as string | undefined,
      limit: String((args.limit as number) ?? 50),
      offset: args.offset != null ? String(args.offset as number) : undefined,
    });
  },
};

export const getWebhookStatsTool: ToolDef = {
  name: "get_webhook_stats",
  description:
    "Get delivery statistics for a specific webhook endpoint: total deliveries, success rate, average response time, and failure breakdown. Useful for monitoring webhook reliability.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      endpoint_id: {
        type: "string",
        description: "Webhook endpoint UUID.",
      },
      hours: {
        type: "number",
        description: "Hours to look back for statistics (1-720, default: 24).",
        default: 24,
      },
    },
    required: ["endpoint_id"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const endpointId = args.endpoint_id as string;
    return client.requestDirect<unknown>(`/webhooks/${encodeURIComponent(endpointId)}/stats`, {
      account_id: resolveSiteId(args),
      hours: String((args.hours as number) ?? 24),
    });
  },
};
