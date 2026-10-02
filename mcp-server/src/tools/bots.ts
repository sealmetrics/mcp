import type { SealMetricsClient } from "../client.js";
import { LIMIT_SCHEMA, resolveSiteId, SITE_ID_SCHEMA } from "./shared.js";
import type { ToolDef } from "./index.js";

export const getBotStatsTool: ToolDef = {
  name: "get_bot_stats",
  description:
    "Get bot detection overview: score distribution, top suspicion flags, and daily trend of human vs suspected-bot traffic over the last `days`. Data exists only when agent analytics is enabled on the site; otherwise the result is zero-filled (total_hits: 0), not an error, and must not be read as a 0% bot share.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
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
      site_id: SITE_ID_SCHEMA,
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
