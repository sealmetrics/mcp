/**
 * Shared domain types for the SealMetrics setup flow, consumed by both the CLI
 * (`sealmetrics`) and the MCP server (`@sealmetrics/mcp`). Presentation
 * concerns (NDJSON envelopes, exit codes, tool responses) live in the consumers,
 * never here (RF-3103).
 */

/** Recognised JS frameworks (RF-301) plus the catch-all. */
export type Framework =
  | "next-app"
  | "next-pages"
  | "astro"
  | "remix"
  | "nuxt"
  | "sveltekit"
  | "vite"
  | "html"
  | "unknown";

/** CMS / ecommerce platforms with an official plugin (RF-305). */
export type Platform =
  | "wordpress"
  | "woocommerce"
  | "prestashop"
  | "magento2"
  | "drupal"
  | "joomla"
  | "opencart";

/** Result of the project detection pass (Bloque 3 / RF-3101a). */
export interface Detection {
  framework: Framework;
  /** Set when a CMS with an official plugin is detected (RF-305/306). */
  platform?: Platform;
  /** Human-readable strategy id reported in `detected:<fw>` lifecycle. */
  strategy: string;
  /** Recommended (informative) file where the snippet should go (RF-302). */
  recommendedLocation: string;
  /** Where exactly in that file ("before </head>", "app.head", …). */
  placementHint: string;
  /** True when there is no project tree to place the snippet into (RF-304). */
  provisionOnly: boolean;
}

/** Unwrapped POST /provision payload (Fase 1 contract). */
export interface ProvisionResult {
  success: boolean;
  account_id: string;
  snippet: string;
  api_key: string;
  dashboard_url: string;
  claim_url: string;
  free_quota: { events_total: number };
  next_steps: string[];
}

/** GET /sites/{id}/pixel/status payload (Fase 1). */
export interface PixelStatus {
  account_id: string;
  installed: boolean;
  first_hit_at: string | null;
  last_hit_at: string | null;
  total_hits: number;
}
