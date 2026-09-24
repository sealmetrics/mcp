import type { SealMetricsClient } from "../client.js";
import type { ToolDef } from "./index.js";
import {
  MARKETING_GUIDE_CONTENT,
  MARKETING_GUIDE_DESCRIPTION,
} from "../resources/marketing-guide.js";

/**
 * `get_marketing_playbook` (PRD mcp-marketing-skill, Bloque 2). A model-controlled
 * tool that returns the marketing playbook (METHOD, not data). It is the
 * auto-invocation primitive: the trigger-oriented description below makes Claude
 * call it on its own when the user asks for a marketing report, after which the
 * model invokes the read-only data tools (get_overview, get_channels, …) to fetch
 * the numbers the playbook tells it to analyze.
 *
 * Registered in ALL_TOOLS, so it inherits the read-only gate: hidden without an
 * api_key, enabled with one (a report needs data, which needs a key — Decisión 2).
 * The handler ignores `client`; it only returns the embedded CONTENT.
 */
export const getMarketingPlaybookTool: ToolDef = {
  name: "get_marketing_playbook",
  description:
    "Call this FIRST whenever the user asks for a marketing report, a weekly/monthly/quarterly " +
    "performance summary, a channel or campaign analysis, conversion or acquisition insights, or " +
    '"how is my marketing doing / why are my sales down / where should I invest". It returns the ' +
    "STEP-BY-STEP METHOD (a playbook) to analyze SealMetrics marketing performance — not the data " +
    "itself. After reading it, follow the steps by calling the read-only data tools (get_overview, " +
    "get_channels, get_traffic_sources, get_conversions, get_landing_pages, …) to fetch the real " +
    "numbers and produce the report. " +
    MARKETING_GUIDE_DESCRIPTION,
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  // The playbook is static content; the handler needs neither the API client nor args.
  handler: async (_client: SealMetricsClient, _args: Record<string, unknown>) => {
    return { playbook: MARKETING_GUIDE_CONTENT };
  },
};
