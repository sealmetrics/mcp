/**
 * Instrumentation guide (Bloque 11 → Fase 3 Bloque 4/5). The canonical API +
 * taxonomy + privacy rules live in the single-source asset
 * `integrations/prompts/sealmetrics-implementation-prompt.md` (embedded as
 * `INSTRUMENTATION_GUIDE`, VAL-3101). This module substitutes the real account_id
 * and hoists the privacy banner. Neither the CLI nor the MCP writes conv()/micro()
 * calls — the agent does, armed with this guide (RF-3401).
 */
import { INSTRUMENTATION_GUIDE } from "./generated/guide.js";

export { INSTRUMENTATION_GUIDE } from "./generated/guide.js";

export const PRIVACY_BANNER = `> ⚠️ **PRIVACY — READ FIRST.** Never pass personal data (names, emails, phones,
> addresses), order/transaction/invoice IDs, or user/customer IDs to any event.
> Track only event types, product names, categories, prices, currencies and
> counts. SealMetrics is cookieless and GDPR-compliant by design.\n\n`;

/**
 * Build the instrumentation guide with the account_id substituted and the privacy
 * banner hoisted to the top. Exported under both names: `buildInstrumentationMarkdown`
 * (CLI legacy) and `getInstrumentationGuide` (PRD RF-3101).
 */
export function buildInstrumentationMarkdown(accountId: string): string {
  const substituted = INSTRUMENTATION_GUIDE.split("[YOUR_ACCOUNT_ID]").join(accountId);
  return (
    `# SealMetrics event instrumentation guide\n\n` +
    `Account ID: \`${accountId}\`\n\n` +
    PRIVACY_BANNER +
    `This guide is the authoritative API + taxonomy for instrumenting business\n` +
    `events. The CLI does **not** write these calls for you (that is a separate,\n` +
    `optional step); use this when you ask your agent to add conversions/events.\n\n` +
    `---\n\n` +
    substituted
  );
}

/** PRD RF-3101 export name; alias of {@link buildInstrumentationMarkdown}. */
export const getInstrumentationGuide = buildInstrumentationMarkdown;
