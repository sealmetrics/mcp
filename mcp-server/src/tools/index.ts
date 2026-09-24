import type { SealMetricsClient } from "../client.js";
import { listSitesTool, getSiteTool } from "./sites.js";
import { getOverviewTool } from "./overview.js";
import {
  getTrafficSourcesTool,
  getTrafficMediumsTool,
  getCampaignsTool,
  getTermsTool,
  getTopSourcesTool,
  getTopCampaignsTool,
  getTopTermsTool,
  getTopReferrersTool,
} from "./traffic.js";
import {
  getPagesTool,
  getLandingPagesTool,
  getTopPagesTool,
  getTopLandingPagesTool,
  getLandingPagesByContentGroupTool,
} from "./pages.js";
import {
  getConversionsTool,
  getMicroconversionsTool,
  listMicroconversionTypesTool,
  getMicroconversionDetailsTool,
  getConversionsRawTool,
  getMicroconversionsRawTool,
  getConversionItemsRawTool,
} from "./conversions.js";
import {
  getCountriesTool,
  getDevicesTool,
  getBrowsersTool,
  getOperatingSystemsTool,
  getDeviceTypesTool,
} from "./audience.js";
import { getFunnelTool } from "./funnel.js";
import { getContentGroupsTool } from "./content.js";
import {
  getChannelsTool,
  getTopChannelsTool,
  listChannelRulesTool,
  testChannelRulesTool,
} from "./channels.js";

export { CHANNEL_WRITE_TOOLS } from "./channels.js";
import { getBotStatsTool, getSuspiciousSessionsTool } from "./bots.js";
import { listSegmentsTool, getSegmentTool } from "./segments.js";
import { listAlertsTool, getAlertHistoryTool, getAlertStatsTool } from "./alerts.js";
import { listWebhooksTool, listWebhookDeliveriesTool, getWebhookStatsTool } from "./webhooks.js";
import { getTrackingCodeTool } from "./tracking.js";
import {
  listPropertyKeysTool,
  getPropertyValuesTool,
  getPropertyBreakdownTool,
} from "./properties.js";
import { getMarketingPlaybookTool } from "./marketing.js";
import { getTroubleshootingGuideTool } from "./support.js";
import { searchDocsTool, getDocTool } from "./docs.js";

// Re-export shared utilities for convenience
export {
  PERIOD_SCHEMA,
  COMPARE_SCHEMA,
  LIMIT_SCHEMA,
  SORT_ORDER_SCHEMA,
  PAGE_SCHEMA,
  resolveSiteId,
} from "./shared.js";

/** Tool definition with name, description, schema, and handler. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * Only for write tools: whether a call can overwrite or remove existing data.
   * Declared explicitly because the MCP default for an undeclared hint is `true`.
   */
  destructiveHint?: boolean;
  handler: (
    client: SealMetricsClient,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

/** All registered tools. */
export const ALL_TOOLS: ToolDef[] = [
  // Sites
  listSitesTool,
  getSiteTool,
  // Overview
  getOverviewTool,
  // Traffic
  getTrafficSourcesTool,
  getTrafficMediumsTool,
  getCampaignsTool,
  getTermsTool,
  getTopSourcesTool,
  getTopCampaignsTool,
  getTopTermsTool,
  getTopReferrersTool,
  // Pages & Content
  getPagesTool,
  getLandingPagesTool,
  getTopPagesTool,
  getTopLandingPagesTool,
  getLandingPagesByContentGroupTool,
  getContentGroupsTool,
  // Conversions
  getConversionsTool,
  getMicroconversionsTool,
  listMicroconversionTypesTool,
  getMicroconversionDetailsTool,
  // Conversions — raw event-level (PRD 08)
  getConversionsRawTool,
  getMicroconversionsRawTool,
  getConversionItemsRawTool,
  // Audience
  getCountriesTool,
  getDevicesTool,
  getDeviceTypesTool,
  getBrowsersTool,
  getOperatingSystemsTool,
  // Channels
  getChannelsTool,
  getTopChannelsTool,
  listChannelRulesTool,
  testChannelRulesTool,
  // Properties
  listPropertyKeysTool,
  getPropertyValuesTool,
  getPropertyBreakdownTool,
  // Funnel
  getFunnelTool,
  // Bot Detection
  getBotStatsTool,
  getSuspiciousSessionsTool,
  // Segments
  listSegmentsTool,
  getSegmentTool,
  // Alerts
  listAlertsTool,
  getAlertHistoryTool,
  getAlertStatsTool,
  // Webhooks
  listWebhooksTool,
  listWebhookDeliveriesTool,
  getWebhookStatsTool,
  // Tracking
  getTrackingCodeTool,
  // Marketing playbook (auto-invocable method; returns the playbook, not data)
  getMarketingPlaybookTool,
  // Troubleshooting guide (auto-invocable; validated support answers, not data)
  getTroubleshootingGuideTool,
  // Live documentation search (docs.sealmetrics.com via llms.txt + /docs-raw)
  searchDocsTool,
  getDocTool,
];
