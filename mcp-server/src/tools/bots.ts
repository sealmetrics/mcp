import type { SealMetricsClient } from "../client.js";
import { LIMIT_SCHEMA, resolveSiteId } from "./shared.js";
import type { ToolDef } from "./index.js";

export const getBotStatsTool: ToolDef = {
  name: "get_bot_stats",
  description:
    "Get bot detection overview: score distribution, top suspicion flags, and daily trend of human vs suspected-bot traffic. Requires agent analytics to be enabled on the site.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID (account_id). Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      days: {
        type: "number",
        description: "Number of days to analyze (1-90, default: 30).",
        default: 30,
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/bot-stats/overview", {
      account_id: resolveSiteId(args),
      days: String((args.days as number) ?? 30),
    });
  },
};

export const getSuspiciousSessionsTool: ToolDef = {
  name: "get_suspicious_sessions",
  description:
    "Get sessions with high bot-suspicion scores for investigation. Shows session details, score, and detected flags. Useful for identifying automated traffic patterns.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: {
        type: "string",
        description: "Site ID (account_id). Optional if SEALMETRICS_SITE_ID env var is set.",
      },
      min_score: {
        type: "number",
        description: "Minimum suspicion score threshold (1-100, default: 50).",
        default: 50,
      },
      limit: LIMIT_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/bot-stats/suspicious-sessions", {
      account_id: resolveSiteId(args),
      min_score: String((args.min_score as number) ?? 50),
      limit: String((args.limit as number) ?? 20),
    });
  },
};
