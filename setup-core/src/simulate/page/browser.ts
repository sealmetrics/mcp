/**
 * Browser resolution for the page-level simulation (PRD-058 F3). `playwright-core`
 * is an optional dependency and ships no browser: this finds one that is already on
 * the machine and never downloads anything (the user is asked first, by the skill).
 *
 * Order: SEALMETRICS_BROWSER_PATH → installed Chrome → installed Edge → Playwright's
 * own Chromium → any Chromium already in the Playwright cache. The last step matters:
 * a cache holds the revisions of whatever Playwright version last ran, which is
 * rarely the one this package pins, and the CDP they speak is compatible enough.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** The part of playwright-core this module uses. Kept local so setup-core has no type dependency on it. */
export interface PlaywrightLike {
  chromium: {
    launch(options: { headless: boolean; channel?: string; executablePath?: string }): Promise<BrowserLike>;
  };
}

export interface BrowserLike {
  version(): string;
  newContext(options?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export type BrowserResolution =
  | { ok: true; browser: BrowserLike; source: string; version: string }
  | { ok: false; reason: "playwright_missing" | "no_browser"; message: string; install: string[] };

const INSTALL = [
  "npm install playwright-core   # in the directory the MCP server runs from, if it is missing",
  "npx playwright install chromium   # ~150 MB; only if no Chrome or Edge is installed",
];

function cachedChromiums(): string[] {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    platform() === "darwin" ? join(homedir(), "Library", "Caches", "ms-playwright") : undefined,
    platform() === "win32" ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright") : undefined,
    join(homedir(), ".cache", "ms-playwright"),
  ].filter((r): r is string => Boolean(r) && existsSync(r!));
  const candidates: string[] = [];
  for (const root of roots) {
    let dirs: string[];
    try {
      dirs = readdirSync(root).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d));
    } catch {
      continue;
    }
    // Newest revision first.
    dirs.sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
    for (const d of dirs) {
      const base = join(root, d);
      for (const rel of [
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
        "chrome-headless-shell-linux64/chrome-headless-shell",
        "chrome-headless-shell-win64/chrome-headless-shell.exe",
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux/chrome",
        "chrome-win/chrome.exe",
      ]) {
        const p = join(base, rel);
        if (existsSync(p)) candidates.push(p);
      }
    }
  }
  return candidates;
}

async function loadPlaywright(): Promise<PlaywrightLike | null> {
  try {
    // A variable specifier keeps bundlers and tsc from requiring the optional package.
    const specifier = "playwright-core";
    return (await import(specifier)) as PlaywrightLike;
  } catch {
    return null;
  }
}

export async function resolveBrowser(): Promise<BrowserResolution> {
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      ok: false,
      reason: "playwright_missing",
      message: "Page-level simulation needs the optional package playwright-core, which is not installed.",
      install: INSTALL,
    };
  }
  const attempts: { source: string; options: { headless: boolean; channel?: string; executablePath?: string } }[] = [];
  if (process.env.SEALMETRICS_BROWSER_PATH) {
    attempts.push({ source: `SEALMETRICS_BROWSER_PATH (${process.env.SEALMETRICS_BROWSER_PATH})`, options: { headless: true, executablePath: process.env.SEALMETRICS_BROWSER_PATH } });
  }
  attempts.push({ source: "installed Chrome", options: { headless: true, channel: "chrome" } });
  attempts.push({ source: "installed Edge", options: { headless: true, channel: "msedge" } });
  attempts.push({ source: "Playwright Chromium", options: { headless: true } });
  for (const path of cachedChromiums()) attempts.push({ source: `cached Chromium (${path})`, options: { headless: true, executablePath: path } });

  for (const attempt of attempts) {
    try {
      const browser = await pw.chromium.launch(attempt.options);
      return { ok: true, browser, source: attempt.source, version: browser.version() };
    } catch {
      /* try the next one */
    }
  }
  return {
    ok: false,
    reason: "no_browser",
    message: "No Chromium-based browser was found: no Chrome or Edge installed, and nothing in the Playwright cache.",
    install: INSTALL,
  };
}
