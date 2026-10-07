#!/usr/bin/env node
/**
 * Codegen (PRD mcp-marketing-skill, Decisión 7): read the canonical marketing
 * playbook Markdown (`src/resources/marketing-skill.md`, the single source written
 * by marketing) and GENERATE `src/resources/marketing-guide.ts` exporting the
 * resource constants. Runs on the `prebuild` hook so every `tsc` build re-syncs.
 *
 * Why codegen and not the obvious alternatives:
 *   (a) `import body from "./x.md"` does NOT compile under plain `tsc` (no bundler);
 *   (b) pasting the body as a template literal by hand is unsafe — the `.md` has
 *       384 backticks / 18 fences that would break the literal.
 * `JSON.stringify` emits a double-quoted string immune to backticks, keeping the
 * `.md` the single source with no divergent copy.
 *
 * Exposes `parseFrontmatter()` / `generateModule()` for the sync test (TEST-MKT01).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const MD_PATH = join(here, "..", "src", "resources", "marketing-skill.md");
export const TS_PATH = join(here, "..", "src", "resources", "marketing-guide.ts");

/** Wrapper constants (the `.md` only carries `name`/`description` frontmatter). */
export const MARKETING_GUIDE_URI = "sealmetrics://marketing-guide";
export const MARKETING_GUIDE_NAME = "SealMetrics Marketing Playbook";

/**
 * Split a Claude Skill `.md` into its YAML frontmatter `description` and the body
 * (everything after the closing `---`). Throws if the frontmatter or description
 * is missing, so a malformed `.md` fails the build loudly instead of shipping empty.
 */
export function parseFrontmatter(md) {
  const normalized = md.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    throw new Error("marketing-skill.md: missing YAML frontmatter (--- ... ---)");
  }
  const yaml = match[1];
  const body = normalized.slice(match[0].length).trim();
  const descMatch = yaml.match(/^description:\s*(.+)$/m);
  if (!descMatch) {
    throw new Error("marketing-skill.md: frontmatter has no `description:` field");
  }
  return { description: descMatch[1].trim(), body };
}

/** Render the `.ts` module source from the `.md` contents. */
export function generateModule(md) {
  const { description, body } = parseFrontmatter(md);
  return `/**
 * AUTO-GENERATED — do not edit by hand.
 * Source: src/resources/marketing-skill.md (the single source, authored by marketing).
 * Regenerate: \`npm run gen-marketing-guide\` (runs automatically on \`prebuild\`).
 *
 * The marketing playbook exposed as an MCP resource + the backing CONTENT for the
 * \`get_marketing_playbook\` tool.
 */
export const MARKETING_GUIDE_URI = ${JSON.stringify(MARKETING_GUIDE_URI)};
export const MARKETING_GUIDE_NAME = ${JSON.stringify(MARKETING_GUIDE_NAME)};
export const MARKETING_GUIDE_DESCRIPTION = ${JSON.stringify(description)};
export const MARKETING_GUIDE_CONTENT = ${JSON.stringify(body)};
`;
}

function main() {
  const md = readFileSync(MD_PATH, "utf8");
  const ts = generateModule(md);
  writeFileSync(TS_PATH, ts);
  console.error(`generated ${TS_PATH} from marketing-skill.md`);
}

// Cross-platform direct-run detection (file:// + backslash path differ on Windows).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
