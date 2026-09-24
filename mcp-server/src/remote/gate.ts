/**
 * Remote transport tool gate (RF-RMT25).
 *
 * A modern api_key can only carry `stats:read` / `sites:read` / `accounts:read`
 * plus the two channel-rule write scopes (`channel_rules:write` /
 * `channel_rules:publish`, PRD-055 Bloque B) — never the broad `read` / `write`
 * (api/src/sealmetrics_api/models/api_tokens.py — API_KEY_ALLOWED_SCOPES), and the
 * scope hierarchy is one-way ("read" implies "stats:read", never the reverse).
 * A remote OAuth connection's api_key is read-only in any case
 * (`API_KEY_SCOPES` in api services/oauth.py is unchanged by Bloque B).
 * The tools below hit routers gated by `require_scope("read")` (segments, alerts,
 * bot-stats, webhooks), so a remote OAuth connection — whose server-side api_key
 * is a modern one — could never call them. Per the PRD decision (2026-07-02) the
 * scopes/routers are NOT touched; the remote transport simply does not list
 * these tools.
 *
 * The channel-groups router is NOT in this set any more: since PRD-055 Bloque A
 * its read endpoints accept `sites:read`, so `get_channels`, `list_channel_rules`
 * and `test_channel_rules` work remotely. `__tests__/remote-transport.test.ts`
 * (RF-A05) executes every listed tool against a recording client and fails if
 * one hits a `require_scope("read")` router — extend that test's prefix list
 * when adding such a router, and this set when adding a tool that uses it.
 */
export const REMOTE_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  // segments router
  "list_segments",
  "get_segment",
  // alerts router
  "list_alerts",
  "get_alert_history",
  "get_alert_stats",
  // bot-stats router
  "get_bot_stats",
  "get_suspicious_sessions",
  // webhooks router
  "list_webhooks",
  "list_webhook_deliveries",
  "get_webhook_stats",
]);
