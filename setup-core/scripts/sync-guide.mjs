#!/usr/bin/env node
/**
 * Single-source guard (VAL-3101). Regenerates `src/generated/guide.ts` from the
 * canonical instrumentation asset
 * `integrations/prompts/sealmetrics-implementation-prompt.md` so the shared core
 * never ships a divergent copy. The CLI keeps its own synced copy from the SAME
 * asset (cli/scripts/sync-guide.mjs); the asset is the single source for both.
 * Run on `prebuild`/`prepare`/`pretest`; a vitest test asserts it stays in sync.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const canonical = join(here, "..", "..", "integrations", "prompts", "sealmetrics-implementation-prompt.md");
const outDir = join(here, "..", "src", "generated");
const out = join(outDir, "guide.ts");

const md = readFileSync(canonical, "utf8");

const banner =
  "// GENERATED FILE — do not edit by hand.\n" +
  "// Source of truth: integrations/prompts/sealmetrics-implementation-prompt.md\n" +
  "// Regenerate with: node scripts/sync-guide.mjs (runs on prebuild/prepare/pretest).\n\n";

const body = "export const INSTRUMENTATION_GUIDE = " + JSON.stringify(md) + ";\n";
const content = banner + body;

if (process.argv.includes("--check")) {
  // CI guard: fail (non-zero) if the committed file is stale instead of writing.
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== content) {
    console.error("guide.ts is out of sync with the canonical asset. Run `npm run sync-guide`.");
    process.exit(1);
  }
  console.error("guide.ts is in sync.");
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(out, content, "utf8");
  console.error(`synced guide → ${out} (${md.length} bytes)`);
}
