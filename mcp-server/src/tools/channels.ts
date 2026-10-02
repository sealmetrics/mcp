import type { SealMetricsClient } from "../client.js";
import { SealMetricsAPIError } from "../errors.js";
import {
  PERIOD_SCHEMA,
  LIMIT_SCHEMA,
  PAGE_SCHEMA,
  START_DATE_SCHEMA,
  END_DATE_SCHEMA,
  dateRangeParams,
  resolveSiteId,
  COUNTRY_SCHEMA,
  countryParam,
  SITE_ID_SCHEMA,
} from "./shared.js";
import type { ToolDef } from "./index.js";

export const getChannelsTool: ToolDef = {
  name: "get_channels",
  description:
    "Get traffic metrics grouped by channel: Paid Search, Organic Search, Social, Direct, Email, Referral, etc. Channels are automatically classified based on UTM parameters and referrer rules.",
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
    // Pass `period` through as-is; the API resolves it with "today" in the
    // account's timezone (PRD-029 RF-008). No client-side date pre-resolution.
    return client.request<unknown>("/channel-groups/stats/channels", {
      account_id: resolveSiteId(args),
      ...dateRangeParams(args),
      page_size: String((args.limit as number) ?? 20),
      page: args.page != null ? String(args.page as number) : undefined,
      country: countryParam(args),
    });
  },
};

export const getTopChannelsTool: ToolDef = {
  name: "get_top_channels",
  description:
    "Get top channels ranked by entrances. Returns a compact list of the top N channels (Paid Search, Organic, Social, etc.) with no pagination. For paginated results use get_channels.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      period: PERIOD_SCHEMA,
      start_date: START_DATE_SCHEMA,
      end_date: END_DATE_SCHEMA,
      limit: LIMIT_SCHEMA,
      country: COUNTRY_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/stats/top-channels", {
      site_id: resolveSiteId(args),
      ...dateRangeParams(args),
      limit: String((args.limit as number) ?? 10),
      country: countryParam(args),
    });
  },
};

export const listChannelRulesTool: ToolDef = {
  name: "list_channel_rules",
  description:
    "List channel group rules configured for a site. Shows how traffic is classified into channels (Paid Search, Organic, Social, etc.) based on UTM parameters and referrer patterns.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      include_inactive: {
        type: "boolean",
        description: "Include inactive rules (default: false).",
      },
      include_defaults: {
        type: "boolean",
        description: "Include default system rules (default: true).",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    return client.request<unknown>("/channel-groups", {
      account_id: resolveSiteId(args),
      include_inactive: args.include_inactive != null ? String(args.include_inactive) : undefined,
      include_defaults: args.include_defaults != null ? String(args.include_defaults) : undefined,
    });
  },
};

// =============================================================================
// Channel rules — tester + draft-only write tools (PRD-035 CHG-014/015)
//
// Invariant (decided 2026-07-16): the MCP NEVER touches a live rule and NEVER
// activates anything. Everything it creates or imports is born "not live"
// (is_active=false); publishing — and any change to a live rule — is always a
// human action in the dashboard. Worst case through this surface: extra
// drafts, never reclassified traffic. None of these tools exposes is_active.
// =============================================================================

const SCOPE_NOTE =
  " Requires an API key with the 'channel_rules:write' scope (or a dashboard session). Even with " +
  "the broader 'channel_rules:publish' scope, this tool still only ever writes drafts.";

const DRAFT_ONLY_NOTE =
  "Rules created here are ALWAYS drafts ('not live'): the tracking pixel ignores them until a human " +
  "switches them live in the dashboard (Site settings → Channels). Channel rules apply to future " +
  "traffic only — historical data keeps its classification. Patterns are RE2 regular expressions " +
  "(Go dialect: no lookahead/lookbehind/backreferences), matched in lowercase; empty pattern = " +
  "matches anything; all non-empty patterns must match (AND). Custom rules are evaluated BEFORE " +
  "the defaults, so a custom rule with the same patterns as a default 'shadows' it — that is the " +
  "supported way to redirect a default channel's traffic elsewhere.";

interface ChannelRuleApiInfo {
  id: number;
  channel_name: string;
  is_default: boolean;
  is_active: boolean;
}

/**
 * Re-map a missing-scope 403 so the model knows which scope to ask for
 * (CHG-015, updated by PRD-055 RF-B09).
 *
 * ONLY when the API's own reason is about a scope: a 403 that says
 * "Access denied to account: X" means the key does not cover that site, and
 * telling the user to create a write-scoped key would send them the wrong way.
 * The Bloque A error mapping keeps the API's reason inside the message, so
 * inspecting it is enough.
 */
function withWriteScopeHint(error: unknown): never {
  if (error instanceof SealMetricsAPIError && error.statusCode === 403) {
    const reason = `${error.message} ${error.detail ?? ""}`;
    if (reason.includes("Required scope")) {
      throw new SealMetricsAPIError(
        403,
        "This tool needs an API key with the 'channel_rules:write' scope (drafts) — " +
          "generate one at Settings > API Keys in the SealMetrics dashboard. " +
          `API said: ${error.message}`,
        error.detail,
      );
    }
  }
  throw error;
}

/** Load a rule and enforce the draft-only invariant for update/delete. */
async function requireDraftRule(
  client: SealMetricsClient,
  siteId: string,
  ruleId: number,
): Promise<ChannelRuleApiInfo> {
  const rule = await client.request<ChannelRuleApiInfo>(`/channel-groups/${ruleId}`, {
    account_id: siteId,
  });
  if (rule.is_default) {
    throw new Error(
      `Rule ${ruleId} is a system default rule and cannot be modified. To redirect its traffic, ` +
        "create a custom rule with the same patterns pointing to another channel (it shadows the default).",
    );
  }
  if (rule.is_active) {
    throw new Error(
      `Rule ${ruleId} ("${rule.channel_name}") is live — switch it off in the dashboard first. ` +
        "The MCP only operates on rules that are not live (draft-only invariant).",
    );
  }
  return rule;
}

export const testChannelRulesTool: ToolDef = {
  name: "test_channel_rules",
  description:
    "Classify a source/medium/campaign combination exactly like the tracking pixel would " +
    "(same RE2 semantics, lowercase matching, custom rules before defaults). Returns the " +
    "resulting channel and the rule that matched. Set include_inactive=true to also evaluate " +
    "draft (not live) custom rules — use it to verify a draft before a human publishes it in " +
    "the dashboard.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      source: { type: "string", description: "utm_source value to classify (e.g. 'google')." },
      medium: { type: "string", description: "utm_medium value to classify (e.g. 'cpc')." },
      campaign: { type: "string", description: "utm_campaign value to classify (optional)." },
      include_inactive: {
        type: "boolean",
        description: "Also evaluate draft (not live) custom rules (default: false).",
      },
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const siteId = resolveSiteId(args);
    return client.post<unknown>(
      `/channel-groups/test?account_id=${encodeURIComponent(siteId)}`,
      {
        source: (args.source as string) ?? "",
        medium: (args.medium as string) ?? "",
        campaign: (args.campaign as string) ?? "",
        include_inactive: (args.include_inactive as boolean) ?? false,
      },
    );
  },
};

export const createChannelRuleTool: ToolDef = {
  name: "create_channel_rule",
  destructiveHint: false,
  description:
    "Create a custom channel classification rule AS A DRAFT for a site. " +
    DRAFT_ONLY_NOTE +
    " After creating, verify it with test_channel_rules (include_inactive=true) and tell the " +
    "user to publish it from the dashboard." +
    SCOPE_NOTE,
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      channel_name: {
        type: "string",
        description: "Destination channel name (max 50 chars), e.g. 'Paid Social'.",
      },
      source_pattern: {
        type: "string",
        description: "RE2 regex for utm_source (empty/omitted = match any), e.g. '^fb$'.",
      },
      medium_pattern: {
        type: "string",
        description: "RE2 regex for utm_medium (empty/omitted = match any), e.g. '^cpc$'.",
      },
      campaign_pattern: {
        type: "string",
        description: "RE2 regex for utm_campaign (empty/omitted = match any).",
      },
      priority: {
        type: "number",
        description: "Priority among the site's custom rules, 0-1000 (higher runs first). Default 50.",
      },
    },
    required: ["channel_name"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const siteId = resolveSiteId(args);
    try {
      return await client.post<unknown>(
        `/channel-groups?account_id=${encodeURIComponent(siteId)}`,
        {
          channel_name: args.channel_name as string,
          source_pattern: (args.source_pattern as string) || null,
          medium_pattern: (args.medium_pattern as string) || null,
          campaign_pattern: (args.campaign_pattern as string) || null,
          priority: (args.priority as number) ?? 50,
          // Draft-only invariant: the MCP can never create a live rule.
          is_active: false,
        },
      );
    } catch (error) {
      withWriteScopeHint(error);
    }
  },
};

export const updateChannelRuleTool: ToolDef = {
  name: "update_channel_rule",
  destructiveHint: true,
  description:
    "Update a DRAFT (not live) custom channel rule. Live rules cannot be modified through the " +
    "MCP — the user must switch them off in the dashboard first. " +
    DRAFT_ONLY_NOTE +
    SCOPE_NOTE,
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      rule_id: { type: "number", description: "ID of the draft rule to update." },
      channel_name: { type: "string", description: "New destination channel name (max 50 chars)." },
      source_pattern: { type: "string", description: "New RE2 regex for utm_source." },
      medium_pattern: { type: "string", description: "New RE2 regex for utm_medium." },
      campaign_pattern: { type: "string", description: "New RE2 regex for utm_campaign." },
      priority: { type: "number", description: "New priority (0-1000)." },
    },
    required: ["rule_id"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const siteId = resolveSiteId(args);
    const ruleId = args.rule_id as number;
    await requireDraftRule(client, siteId, ruleId);

    const body: Record<string, unknown> = {};
    if (args.channel_name != null) body.channel_name = args.channel_name;
    if (args.source_pattern != null) body.source_pattern = args.source_pattern;
    if (args.medium_pattern != null) body.medium_pattern = args.medium_pattern;
    if (args.campaign_pattern != null) body.campaign_pattern = args.campaign_pattern;
    if (args.priority != null) body.priority = args.priority;

    try {
      // only_if_inactive: the API enforces the draft-only guard atomically in
      // the UPDATE's WHERE clause — no TOCTOU if the rule goes live between
      // the check above and this write.
      return await client.patch<unknown>(
        `/channel-groups/${ruleId}?account_id=${encodeURIComponent(siteId)}&only_if_inactive=true`,
        body,
      );
    } catch (error) {
      withWriteScopeHint(error);
    }
  },
};

export const deleteChannelRuleTool: ToolDef = {
  name: "delete_channel_rule",
  destructiveHint: true,
  description:
    "Delete a DRAFT (not live) custom channel rule. Live rules cannot be deleted through the " +
    "MCP — the user must switch them off in the dashboard first. Default system rules can never " +
    "be deleted." +
    SCOPE_NOTE,
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      rule_id: { type: "number", description: "ID of the draft rule to delete." },
    },
    required: ["rule_id"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const siteId = resolveSiteId(args);
    const ruleId = args.rule_id as number;
    const rule = await requireDraftRule(client, siteId, ruleId);

    try {
      // Atomic draft-only guard, same as update (no TOCTOU).
      await client.del(
        `/channel-groups/${ruleId}?account_id=${encodeURIComponent(siteId)}&only_if_inactive=true`,
      );
    } catch (error) {
      withWriteScopeHint(error);
    }
    return { deleted: true, rule_id: ruleId, channel_name: rule.channel_name };
  },
};

export const importChannelRulesTool: ToolDef = {
  name: "import_channel_rules",
  destructiveHint: true,
  description:
    "Import a set of channel rules as DRAFTS (bulk). Replaces ONLY the site's existing draft " +
    "(not live) rules — live rules are never touched — and every imported rule enters as not " +
    "live, even if the payload says otherwise (the response flags forced_inactive when that " +
    "happens). By default runs as a dry run (dry_run=true): validates and reports per-rule " +
    "errors without writing anything; pass dry_run=false to actually replace the drafts. " +
    DRAFT_ONLY_NOTE +
    SCOPE_NOTE,
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
      rules: {
        type: "array",
        description:
          "Array of rules: {channel_name, source_pattern?, medium_pattern?, campaign_pattern?, " +
          "priority?}. Patterns are RE2 regexes; at least one pattern per rule is required.",
      },
      dry_run: {
        type: "boolean",
        description: "Default TRUE: validate and report without writing. Set false to import.",
      },
    },
    required: ["rules"],
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const siteId = resolveSiteId(args);
    const dryRun = (args.dry_run as boolean) ?? true;
    const rules = (args.rules as unknown[]) ?? [];

    const query =
      `account_id=${encodeURIComponent(siteId)}` +
      `&dry_run=${dryRun ? "true" : "false"}` +
      // Draft-only invariant: the MCP always imports into the drafts scope.
      `&scope=drafts`;

    try {
      return await client.post<unknown>(`/channel-groups/import?${query}`, {
        version: 1,
        rules,
      });
    } catch (error) {
      withWriteScopeHint(error);
    }
  },
};

/** Draft-only write tools (registered separately — NOT readOnlyHint). */
export const CHANNEL_WRITE_TOOLS: ToolDef[] = [
  createChannelRuleTool,
  updateChannelRuleTool,
  deleteChannelRuleTool,
  importChannelRulesTool,
];
