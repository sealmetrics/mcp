/**
 * Compile-time constants for the MCP write-path.
 *
 * The provision key is **publishable** (Fase 1, RF-202 / RF-1001 / VAL-3301): it
 * only grants attribution + rate-limited access to POST /provision and is
 * revocable per channel without republishing. It is NEVER a TOKEN_SECRET/
 * API_KEY_SECRET.
 *
 * This is the **dedicated `mcp`-channel key** (RF-3205 / PRE-2), distinct from the
 * CLI's `npx` key, so the chat-provisioning channel can be revoked on its own
 * without touching the CLI (VAL-3601). Set SEALMETRICS_PROVISION_KEY to target
 * any other environment, which has its own keys.
 */
export const EMBEDDED_PROVISION_KEY = "pk_mcp_69bb5a1ec96f2cc4d5dd77be";

/** Publishable key seeded only in a local development database. */
export const FALLBACK_PROVISION_KEY = "pk_provision_fallback";

/** Attribution channel sent as `install_source` on /provision (RF-3205 / RF-3604). */
export const INSTALL_SOURCE = "mcp";

/**
 * True for a local development base URL, the only target where the seeded
 * development key is used automatically. Every deployed environment — including
 * pre-production — needs SEALMETRICS_PROVISION_KEY set explicitly, so this file
 * carries no usable key for anything that is reachable from the internet.
 */
export function isNonProdTarget(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1/.test(baseUrl);
}

/**
 * Resolve the provision key to embed in /provision requests. Precedence:
 * explicit env (SEALMETRICS_PROVISION_KEY) > local development fallback >
 * embedded PROD mcp-channel key (mirrors the CLI's resolveProvisionKey).
 */
export function resolveProvisionKey(baseUrl: string): string {
  if (process.env.SEALMETRICS_PROVISION_KEY) return process.env.SEALMETRICS_PROVISION_KEY;
  if (isNonProdTarget(baseUrl)) return FALLBACK_PROVISION_KEY;
  return EMBEDDED_PROVISION_KEY;
}
