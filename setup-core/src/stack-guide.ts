/**
 * Per-framework loading knowledge (Fase 3 Bloque 5, RF-3501/3502). This is
 * *knowledge we hand the agent*, NOT code we write into the user's repo
 * (RF-3503/VAL-3502): the right place + the right way to load the tracker snippet
 * in each detected stack — async load, SPA/History-API behaviour, the `group`
 * content-grouping parameter, AUTO mode. For CMS platforms with an official
 * plugin we point at the plugin (RF-3502), never edit PHP.
 *
 * Single source for the snippet/loading contract: `docs/TRACKER.md` (VAL-3501).
 * The actual `<script>` snippet is returned by POST /provision — these notes say
 * WHERE it goes and WHAT to watch for, not the snippet bytes.
 */
import type { Framework, Platform } from "./types.js";

export interface StackGuide {
  /** The detected stack this guide is for. */
  framework: Framework;
  /** Recommended file to place the snippet in. */
  location: string;
  /** Human-readable placement (where in that file). */
  placement: string;
  /** Step-by-step, framework-correct loading notes (async, SPA, group, AUTO). */
  notes: string[];
}

/** Shared notes that apply to every JS stack (kept DRY, appended per stack). */
const COMMON_NOTES = [
  "Load the snippet returned by POST /provision as-is — it is already async/defer-safe; do not block rendering.",
  "Place it once, as high in <head> as possible, so it loads on every page (not per-route).",
  "SPA / client-side routing: the tracker auto-tracks History API navigations (pushState/replaceState) — you do NOT need to fire a manual pageview on route change. Verify a route change produces a new pageview before adding any manual call.",
  "Content grouping: add the `group` parameter (or call the AUTO mode documented in docs/TRACKER.md) to bucket pages; never hardcode per-page groups in the snippet itself.",
];

export const STACK_GUIDES: Record<Framework, StackGuide> = {
  "next-app": {
    framework: "next-app",
    location: "app/layout.tsx",
    placement: "inside <head> of the root layout, or via a next/script <Script strategy=\"afterInteractive\"> component",
    notes: [
      "App Router: put the snippet in the root app/layout.tsx so it covers every route segment.",
      "Prefer next/script with strategy=\"afterInteractive\" for the external script tag; keep the inline init in <head>.",
      "Do NOT place it in a single page.tsx — that would only load on that route.",
      ...COMMON_NOTES,
    ],
  },
  "next-pages": {
    framework: "next-pages",
    location: "pages/_document.tsx",
    placement: "inside <Head> in _document.tsx (covers every page), or pages/_app.tsx with next/script",
    notes: [
      "Pages Router: _document.tsx renders once per page on the server — the snippet belongs in its <Head>.",
      "Alternatively use next/script in pages/_app.tsx so it mounts on every route.",
      ...COMMON_NOTES,
    ],
  },
  astro: {
    framework: "astro",
    location: "src/layouts/Layout.astro",
    placement: "inside <head> of your root layout component",
    notes: [
      "Add it to the shared root layout that every page imports, not to individual .astro pages.",
      "Astro ships zero JS by default — the snippet is plain <script>, so it runs as written.",
      ...COMMON_NOTES,
    ],
  },
  remix: {
    framework: "remix",
    location: "app/root.tsx",
    placement: "inside the <head> region of the root route (the <Links/>/<Meta/> area)",
    notes: [
      "app/root.tsx wraps every route — place the snippet in its <head> so it loads globally.",
      ...COMMON_NOTES,
    ],
  },
  nuxt: {
    framework: "nuxt",
    location: "nuxt.config.ts",
    placement: "in app.head.script (or a <head> block in app.vue)",
    notes: [
      "Use app.head.script in nuxt.config.ts so Nuxt injects the tag on every page.",
      "Keep `src` async; do not import it as a module.",
      ...COMMON_NOTES,
    ],
  },
  sveltekit: {
    framework: "sveltekit",
    location: "src/app.html",
    placement: "inside <head>, above %sveltekit.head%",
    notes: [
      "src/app.html is the single HTML shell for the whole app — the snippet belongs in its <head>.",
      "Placing it above %sveltekit.head% guarantees it loads before route components.",
      ...COMMON_NOTES,
    ],
  },
  vite: {
    framework: "vite",
    location: "index.html",
    placement: "just before </head> in the project root index.html",
    notes: [
      "Vite serves index.html as the entry — add the snippet to its <head> directly.",
      ...COMMON_NOTES,
    ],
  },
  html: {
    framework: "html",
    location: "index.html",
    placement: "just before </head> on every page",
    notes: [
      "Static site: add the snippet to the <head> of every HTML page (or your shared header include/partial).",
      ...COMMON_NOTES,
    ],
  },
  unknown: {
    framework: "unknown",
    location: "your site's root HTML / <head>",
    placement: "just before the closing </head> tag on every page",
    notes: [
      "Stack not auto-detected: place the snippet in the <head> of every page via whatever shared template/layout your site uses.",
      ...COMMON_NOTES,
    ],
  },
};

/** Return the loading guide for a detected framework (RF-3501). */
export function getStackGuide(framework: Framework): StackGuide {
  return STACK_GUIDES[framework] ?? STACK_GUIDES.unknown;
}

/**
 * Guidance for a CMS/ecommerce platform that has an official plugin (RF-3502):
 * point at the plugin + where to paste the account_id. Never edit PHP/theme files.
 */
export function getPlatformPluginGuide(platform: Platform, accountId: string): string {
  const product: Record<Platform, string> = {
    wordpress: "SealMetrics for WordPress plugin",
    woocommerce: "SealMetrics for WooCommerce plugin",
    prestashop: "SealMetrics PrestaShop module",
    magento2: "SealMetrics Magento 2 extension",
    drupal: "SealMetrics Drupal module",
    joomla: "SealMetrics Joomla plugin",
    opencart: "SealMetrics OpenCart extension",
  };
  return (
    `Install the official ${product[platform]} (see integrations/sealmetrics-${platform}.zip), ` +
    `then paste your account_id \`${accountId}\` into its settings. ` +
    `Do not edit theme/PHP files or paste the raw <script> snippet — the plugin injects the tracker correctly.`
  );
}
