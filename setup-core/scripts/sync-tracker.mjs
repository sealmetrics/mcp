#!/usr/bin/env node
/**
 * Single-source guard for the simulator (PRD-058 A2). `simulate_install` must run
 * the tracker production serves, and that is the code embedded in
 * `pixel-service/internal/handler/tracker.go` (`DefaultTrackerCode`,
 * `DefaultAgentTrackerCode`) — NOT `tracker/dist/t.min.js`, which is only
 * rewritten on a local build and was stale on 2026-09-14 (1899 vs 1959 bytes,
 * without the `aid` in the session hash). Regenerates `src/generated/tracker.ts`.
 * Run on `prebuild`/`prepare`/`pretest`; `--check` fails if the committed file drifted.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const goFile = join(here, "..", "..", "pixel-service", "internal", "handler", "tracker.go");
const outDir = join(here, "..", "src", "generated");
const out = join(outDir, "tracker.ts");

// Builds that copy only setup-core (mcp-server/Dockerfile.remote) have no
// pixel-service tree: keep the committed file rather than fail the image.
if (!existsSync(goFile) && !process.argv.includes("--check") && existsSync(out)) {
  console.error(`sync-tracker: ${goFile} not present; keeping committed tracker.ts`);
  process.exit(0);
}

const go = readFileSync(goFile, "utf8");

function extract(varName) {
  const m = go.match(new RegExp("var " + varName + " = `([^`]*)`"));
  if (!m) {
    console.error(`sync-tracker: ${varName} not found in ${goFile}`);
    process.exit(1);
  }
  return m[1];
}

const tracker = extract("DefaultTrackerCode");
const agent = extract("DefaultAgentTrackerCode");
const sha = (s) => createHash("sha256").update(s).digest("hex");

const content =
  "// GENERATED FILE — do not edit by hand.\n" +
  "// Source of truth: pixel-service/internal/handler/tracker.go (what production serves).\n" +
  "// Regenerate with: node scripts/sync-tracker.mjs (runs on prebuild/prepare/pretest).\n\n" +
  "/** Minified tracker.js template with {{PLACEHOLDERS}} (`DefaultTrackerCode`). */\n" +
  "export const TRACKER_CODE = " + JSON.stringify(tracker) + ";\n" +
  "export const TRACKER_SHA256 = " + JSON.stringify(sha(tracker)) + ";\n\n" +
  "/** Minified tracker-agent.js template, served to agent-analytics accounts (`DefaultAgentTrackerCode`). */\n" +
  "export const AGENT_TRACKER_CODE = " + JSON.stringify(agent) + ";\n" +
  "export const AGENT_TRACKER_SHA256 = " + JSON.stringify(sha(agent)) + ";\n";

if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== content) {
    console.error("tracker.ts is out of sync with pixel-service tracker.go. Run `npm run sync-tracker`.");
    process.exit(1);
  }
  console.error("tracker.ts is in sync.");
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(out, content, "utf8");
  console.error(`synced tracker → ${out} (${tracker.length} + ${agent.length} bytes)`);
}
