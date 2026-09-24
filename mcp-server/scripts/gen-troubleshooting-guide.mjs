#!/usr/bin/env node
/**
 * Codegen twin of gen-marketing-guide.mjs: read the canonical troubleshooting
 * guide Markdown (`src/resources/troubleshooting-skill.md`, the single source
 * distilled from validated support resolutions) and GENERATE
 * `src/resources/troubleshooting-guide.ts` exporting the resource constants.
 * Runs on the `prebuild` hook so every `tsc` build re-syncs.
 *
 * Frontmatter parsing is shared with the marketing codegen (same Skill `.md`
 * format); only the wrapper constants differ.
 *
 * Exposes `generateModule()` for the sync test (troubleshooting-skill.test.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFrontmatter } from "./gen-marketing-guide.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const MD_PATH = join(here, "..", "src", "resources", "troubleshooting-skill.md");
export const TS_PATH = join(here, "..", "src", "resources", "troubleshooting-guide.ts");

/** Wrapper constants (the `.md` only carries `name`/`description` frontmatter). */
export const TROUBLESHOOTING_GUIDE_URI = "sealmetrics://troubleshooting-guide";
export const TROUBLESHOOTING_GUIDE_NAME = "SealMetrics Troubleshooting Guide";

/** Render the `.ts` module source from the `.md` contents. */
export function generateModule(md) {
  const { description, body } = parseFrontmatter(md);
  return `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: src/resources/troubleshooting-skill.md (the single source, distilled
 * from validated support resolutions).
 * Regenerate: \`npm run gen-troubleshooting-guide\` (runs automatically on \`prebuild\`).
 *
 * The troubleshooting guide exposed as an MCP resource + the backing CONTENT
 * for the \`get_troubleshooting_guide\` tool.
 */
export const TROUBLESHOOTING_GUIDE_URI = ${JSON.stringify(TROUBLESHOOTING_GUIDE_URI)};
export const TROUBLESHOOTING_GUIDE_NAME = ${JSON.stringify(TROUBLESHOOTING_GUIDE_NAME)};
export const TROUBLESHOOTING_GUIDE_DESCRIPTION = ${JSON.stringify(description)};
export const TROUBLESHOOTING_GUIDE_CONTENT = ${JSON.stringify(body)};
`;
}

function main() {
  const md = readFileSync(MD_PATH, "utf8");
  const ts = generateModule(md);
  writeFileSync(TS_PATH, ts);
  console.error(`generated ${TS_PATH} from troubleshooting-skill.md`);
}

// Cross-platform direct-run detection (file:// + backslash path differ on Windows).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
