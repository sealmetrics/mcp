/**
 * Read-only repository scan (PRD-058 PL-13, PL-14, SM-10). Finds Sealmetrics loaders
 * and `sealmetrics.conv/micro('<name>')` calls already in the site's source. Bounded
 * so a monorepo cannot stall a tool call; never writes (RF-3204).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SOURCE_EXT = /\.(html?|jsx?|tsx?|mjs|cjs|vue|svelte|astro|php|liquid|erb|hbs|njk|twig)$/i;
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".astro", ".vercel", ".output",
  "dist", "build", "out", "coverage", "vendor", ".turbo", ".cache",
]);
const MAX_FILES = 5000;
const MAX_BYTES = 1024 * 1024;

export interface RepoCall {
  file: string;
  line: number;
  kind: "conv" | "micro";
  name: string;
}

export interface RepoScan {
  files_scanned: number;
  truncated: boolean;
  /** Tracker loaders: `t.sealmetrics.com/t.js`, the v1 `sm.js`, or a stub. */
  loaders: { file: string; line: number; text: string }[];
  calls: RepoCall[];
}

const LOADER_RE = /(\/t\.js\?[^"'`\s]*\bid=|sealmetrics\.com\/[^"'`\s]*\.js|w\.sealmetrics\.q\b)/;
const CALL_RE = /\b(?:window\.)?(?:sealmetrics|_?sm)\??\.(conv|micro)\(\s*['"`]([^'"`]+)['"`]/g;

export function scanRepo(root: string): RepoScan {
  const scan: RepoScan = { files_scanned: 0, truncated: false, loaders: [], calls: [] };
  const walk = (dir: string) => {
    if (scan.truncated) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scan.files_scanned >= MAX_FILES) {
        scan.truncated = true;
        return;
      }
      const path = join(dir, entry);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(entry) && !entry.startsWith(".")) walk(path);
        continue;
      }
      if (!SOURCE_EXT.test(entry) || st.size > MAX_BYTES) continue;
      scan.files_scanned++;
      scanFile(root, path, scan);
    }
  };
  walk(root);
  return scan;
}

function scanFile(root: string, path: string, scan: RepoScan): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const file = relative(root, path);
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    if (LOADER_RE.test(l)) scan.loaders.push({ file, line: i + 1, text: l.trim().slice(0, 160) });
  });
  for (const m of text.matchAll(CALL_RE)) {
    const line = text.slice(0, m.index ?? 0).split("\n").length;
    scan.calls.push({ file, line, kind: m[1] as "conv" | "micro", name: m[2] });
  }
}

/** SM-10: does `file` contain a call to `name` within ±`window` lines of `line`? */
export function fileHasCall(root: string, file: string, name: string, line?: number, window = 10): boolean {
  let text: string;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    return false;
  }
  for (const m of text.matchAll(CALL_RE)) {
    if (m[2] !== name) continue;
    if (line === undefined) return true;
    const at = text.slice(0, m.index ?? 0).split("\n").length;
    if (Math.abs(at - line) <= window) return true;
  }
  return false;
}
