import type { SealMetricsClient } from "../client.js";
import type { ToolDef } from "./index.js";
import {
  TROUBLESHOOTING_GUIDE_CONTENT,
  TROUBLESHOOTING_GUIDE_DESCRIPTION,
} from "../resources/troubleshooting-guide.js";

/**
 * `get_troubleshooting_guide` — the support twin of `get_marketing_playbook`.
 * A model-controlled tool that returns the validated symptom→cause→fix guide
 * distilled from real support cases. The trigger-oriented description below
 * makes the user's agent call it on its own when the user reports a SealMetrics
 * problem, so the answer comes from validated resolutions instead of guesses;
 * the guide then points the model at the verification tools
 * (test_channel_rules, verify_event_instrumented, raw endpoints, …) to confirm
 * with real data.
 *
 * Registered in ALL_TOOLS, so it inherits the read-only gate: hidden without an
 * api_key, enabled with one. The handler ignores `client`; it only returns the
 * embedded CONTENT.
 */
export const getTroubleshootingGuideTool: ToolDef = {
  name: "get_troubleshooting_guide",
  description:
    "Returns the SealMetrics troubleshooting guide as text; it contains no site data. " +
    TROUBLESHOOTING_GUIDE_DESCRIPTION,
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  // The guide is static content; the handler needs neither the API client nor args.
  handler: async (_client: SealMetricsClient, _args: Record<string, unknown>) => {
    return { guide: TROUBLESHOOTING_GUIDE_CONTENT };
  },
};
