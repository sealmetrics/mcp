import type { SealMetricsClient } from "../client.js";
import { LIMIT_SCHEMA, resolveSiteId } from "./shared.js";
import type { ToolDef } from "./index.js";

export const listAlertsTool: ToolDef = {
  name: "list_alerts",
  description:
    "List alert rules configured for a site. Shows rule name, metric, condition, threshold, and status (active/paused). Alerts monitor metrics and trigger notifications when thresholds are crossed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID (account_id). Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      include_inactive: {
        type: "boolean",
        description: "Include inactive/paused alert rules (default: false).",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestDirect<unknown>("/alerts/rules", {
      account_id: resolveSiteId(args),
      include_inactive: args.include_inactive != null ? String(args.include_inactive) : undefined,
    });
  },
};

export const getAlertHistoryTool: ToolDef = {
  name: "get_alert_history",
  description:
    "Get history of triggered alerts: when they fired, current status (active/resolved/acknowledged), and which rule triggered them. Useful for reviewing past incidents.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID (account_id). Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      rule_id: {
        type: "number",
        description: "Filter by specific alert rule ID.",
      },
      status: {
        type: "string",
        description: "Filter by alert status.",
        enum: ["active", "resolved", "acknowledged"],
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
    return client.requestDirect<unknown>("/alerts/history", {
      account_id: resolveSiteId(args),
      rule_id: args.rule_id != null ? String(args.rule_id) : undefined,
      status: args.status as string | undefined,
      limit: String((args.limit as number) ?? 50),
      offset: args.offset != null ? String(args.offset as number) : undefined,
    });
  },
};

export const getAlertStatsTool: ToolDef = {
  name: "get_alert_stats",
  description:
    "Get alert statistics for a site: total rules, active alerts, resolved count, and acknowledgement rate. Provides a quick health overview of the alerting system.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID (account_id). Optional if SEALMETRICS_SITE_ID env var is set.",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.requestDirect<unknown>("/alerts/stats", {
      account_id: resolveSiteId(args),
    });
  },
};
