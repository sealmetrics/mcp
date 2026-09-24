/**
 * Compile-time constants for the MCP write-path.
 *
 * The provision key is **publishable** (Fase 1, RF-202 / RF-1001 / VAL-3301): it
 * only grants attribution + rate-limited access to POST /provision and is
 * revocable per channel without republishing. It is NEVER a TOKEN_SECRET/
 * API_KEY_SECRET.
 *
 * This is the **dedicated `mcp`-channel key** (RF-3205 / PRE-2), distinct from the
 * CLI's `npx` key and the `pk_provision_fallback`. A separate key lets us revoke
 * the chat-provisioning channel on its own:
 *   UPDATE provision_keys SET is_active=FALSE WHERE channel='mcp';   (VAL-3601)
 * without touching the CLI. Override with SEALMETRICS_PROVISION_KEY when targeting
 * local/PRE (the PROD key doesn't exist there — use `pk_provision_fallback`).
 */
export const EMBEDDED_PROVISION_KEY = "pk_mcp_69bb5a1ec96f2cc4d5dd77be";

/** Publishable fallback key seeded in non-prod DBs (local/PRE) but NOT in PROD. */
export const FALLBACK_PROVISION_KEY = "pk_provision_fallback";

/** Attribution channel sent as `install_source` on /provision (RF-3205 / RF-3604). */
export const INSTALL_SOURCE = "mcp";

/** True for local/PRE base URLs, where the fallback provision key is auto-used. */
export function isNonProdTarget(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1|pre\.sealmetrics\.com/.test(baseUrl);
}

/**
 * Resolve the provision key to embed in /provision requests. Precedence:
 * explicit env (SEALMETRICS_PROVISION_KEY) > local/PRE auto-fallback > embedded
 * PROD mcp-channel key (mirrors the CLI's resolveProvisionKey).
 */
export function resolveProvisionKey(baseUrl: string): string {
  if (process.env.SEALMETRICS_PROVISION_KEY) return process.env.SEALMETRICS_PROVISION_KEY;
  if (isNonProdTarget(baseUrl)) return FALLBACK_PROVISION_KEY;
  return EMBEDDED_PROVISION_KEY;
}
