#!/usr/bin/env node
/**
 * Bundle the MCP server into a single `dist/index.js` (RF-3305: the `.mcpb` ships
 * a *vendored, pinned* server, NOT `npx -y @sealmetrics/mcp`, so it needs
 * no Node toolchain or network at startup — Claude Desktop brings the runtime).
 *
 * We inline `@sealmetrics/setup-core` (our zero-dep workspace package) so the
 * published/packaged artifact has no `file:` dependency to resolve, while keeping
 * the real runtime deps (`@modelcontextprotocol/sdk`, `zod`) external — the `.mcpb`
 * pack step bundles those from node_modules, and an `npm publish` declares them.
 *
 * Dev/test never run this; they resolve setup-core through the node_modules link.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "dist", "index.js");

await build({
  entryPoints: [entry],
  outfile: entry,
  allowOverwrite: true,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Inline only our workspace package; keep declared runtime deps external.
  // playwright-core is optional (PRD-058 F3): setup-core imports it at runtime only for
  // page-level simulation, and a missing package is reported as `unavailable`.
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod", "playwright-core"],
});

console.error(`bundled setup-core into ${entry} (sdk/zod kept external)`);
