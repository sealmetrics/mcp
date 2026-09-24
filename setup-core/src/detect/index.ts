/**
 * Project detection (Bloque 3 / RF-3101a). Read-only (RF-1003): classifies the
 * project by reading markers (package.json deps/scripts, config files, tree) and
 * maps it to an *informative* recommended snippet location (RF-302). Neither the
 * CLI nor the MCP writes to that location — they only tell the agent/human where
 * the snippet goes.
 *
 * Best-effort and conservative (VAL-301): when in doubt it returns `unknown` and
 * falls back to the manual path rather than guessing wrong.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Detection, Framework, Platform } from "../types.js";
import { detectPlatform } from "./cms.js";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const LOCATIONS: Record<Framework, { location: string; hint: string; strategy: string }> = {
  "next-app": {
    location: "app/layout.tsx",
    hint: "inside <head>, or via a next/script <Script> component",
    strategy: "next-app-router-layout",
  },
  "next-pages": {
    location: "pages/_document.tsx",
    hint: "inside <Head> in _document (or pages/_app.tsx)",
    strategy: "next-pages-document",
  },
  astro: {
    location: "src/layouts/Layout.astro",
    hint: "inside <head> of your root layout",
    strategy: "astro-layout-head",
  },
  remix: {
    location: "app/root.tsx",
    hint: "inside the <head> region of the root route",
    strategy: "remix-root-head",
  },
  nuxt: {
    location: "nuxt.config.ts",
    hint: "in app.head.script (or app.vue <head>)",
    strategy: "nuxt-config-head",
  },
  sveltekit: {
    location: "src/app.html",
    hint: "inside <head>, above %sveltekit.head%",
    strategy: "sveltekit-app-html",
  },
  vite: {
    location: "index.html",
    hint: "just before </head>",
    strategy: "vite-index-html",
  },
  html: {
    location: "index.html",
    hint: "just before </head>",
    strategy: "static-html-head",
  },
  unknown: {
    location: "your site's root HTML / <head>",
    hint: "just before the closing </head> tag on every page",
    strategy: "manual",
  },
};

/**
 * Detect the framework/platform of the project rooted at `cwd`.
 * Exported as `detect` (CLI legacy name) and `detectFramework` (PRD RF-3101 name).
 */
export function detect(cwd: string, opts?: { noInject?: boolean }): Detection {
  // RF-304: provision-only when forced or when there's nothing to place into.
  if (opts?.noInject) {
    return makeDetection("unknown", { provisionOnly: true });
  }

  const platform = detectPlatform(cwd);
  if (platform) {
    // RF-305/306: CMS with an official plugin — do NOT edit PHP/theme files.
    return makeDetection("unknown", { platform, provisionOnly: false });
  }

  const pkg = readPackageJson(cwd);
  if (pkg) {
    const fw = detectFromPackageJson(cwd, pkg);
    return makeDetection(fw, { provisionOnly: false });
  }

  // No package.json — a static site if there's an index.html, else nothing to place into.
  if (findIndexHtml(cwd)) {
    return makeDetection("html", { provisionOnly: false });
  }

  if (isEmptyish(cwd)) {
    return makeDetection("unknown", { provisionOnly: true });
  }

  // There IS a repo but we don't recognise it (RF-303): manual, not provision-only.
  return makeDetection("unknown", { provisionOnly: false });
}

/** PRD RF-3101 export name; alias of {@link detect}. */
export const detectFramework = detect;

function detectFromPackageJson(cwd: string, pkg: PackageJson): Framework {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  if (has("next")) {
    return hasAppRouter(cwd) ? "next-app" : "next-pages";
  }
  if (has("astro")) return "astro";
  if (has("@remix-run/react") || has("@remix-run/node") || has("@remix-run/serve")) return "remix";
  if (has("nuxt") || has("nuxt3") || has("nuxt-edge")) return "nuxt";
  if (has("@sveltejs/kit")) return "sveltekit";
  if (has("vite")) return "vite";
  // A package.json with none of the markers but an index.html → treat as static.
  if (findIndexHtml(cwd)) return "html";
  return "unknown";
}

function hasAppRouter(cwd: string): boolean {
  // App router if app/ exists (and is preferred); fall back to pages/.
  const appDirs = ["app", "src/app"];
  const pagesDirs = ["pages", "src/pages"];
  const hasApp = appDirs.some((d) => existsSync(join(cwd, d)));
  const hasPages = pagesDirs.some((d) => existsSync(join(cwd, d)));
  if (hasApp) return true;
  if (hasPages) return false;
  // Default for modern Next.js is the app router.
  return true;
}

function readPackageJson(cwd: string): PackageJson | null {
  const p = join(cwd, "package.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function findIndexHtml(cwd: string): boolean {
  return ["index.html", "public/index.html", "src/index.html"].some((f) =>
    existsSync(join(cwd, f)),
  );
}

function isEmptyish(cwd: string): boolean {
  try {
    const entries = readdirSync(cwd).filter(
      (e) => !e.startsWith(".") && e !== "seal.config.json",
    );
    return entries.length === 0;
  } catch {
    return true;
  }
}

function makeDetection(
  framework: Framework,
  extra: { platform?: Platform; provisionOnly: boolean },
): Detection {
  const loc = LOCATIONS[framework];
  const detection: Detection = {
    framework,
    strategy: extra.platform ? `cms-plugin-${extra.platform}` : loc.strategy,
    recommendedLocation: loc.location,
    placementHint: loc.hint,
    provisionOnly: extra.provisionOnly,
  };
  if (extra.platform) detection.platform = extra.platform;
  return detection;
}

export { detectPlatform, PLATFORM_PLUGIN_HINT } from "./cms.js";
