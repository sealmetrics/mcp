#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { resolveProvisionKey } from "./embedded.js";
import { createRequire } from "module";

// Read the version from package.json, but degrade gracefully: in the bundled
// `.mcpb` there is no sibling package.json (the version is cosmetic there — the
// manifest carries the real one), so a missing file must NOT crash startup.
let PKG_VERSION = "0.0.0";
try {
  const req = createRequire(import.meta.url);
  PKG_VERSION = (req("../package.json") as { version: string }).version ?? PKG_VERSION;
} catch {
  // bundled standalone (.mcpb) — keep the fallback.
}

const API_KEY = process.env.SEALMETRICS_API_KEY;
const BASE_URL =
  process.env.SEALMETRICS_BASE_URL ?? "https://my.sealmetrics.com/api/v1";

// Relaxed startup gate (RF-3202): no process.exit when SEALMETRICS_API_KEY is
// missing. Without a key the server starts in SETUP-ONLY mode (only the setup
// tools are exposed); the ~47 read-only data tools stay hidden until a key is
// present — set in the env at boot, or adopted at runtime from provision_site
// (RF-3202b). With a key, the read-only tools behave exactly as in v1.2.0 and the
// setup tools are added on top (VAL-3202).
const PROVISION_KEY = resolveProvisionKey(BASE_URL);
if (PROVISION_KEY === "pk_mcp_PLACEHOLDER_REPLACE_BEFORE_PUBLISH") {
  // Safe (provision_site just fails AUTH_REQUIRED) but a silent failure is hard to
  // diagnose — warn the operator that PRE-2 (bake the mcp-channel key) is pending.
  console.error(
    "[sealmetrics-mcp] WARNING: using the placeholder mcp provision key — provision_site will fail until the channel='mcp' key is configured.",
  );
}

const { server } = buildServer({
  apiKey: API_KEY,
  baseUrl: BASE_URL,
  provisionKey: PROVISION_KEY,
  version: PKG_VERSION,
  // Only pass a cwd when an explicit project dir is configured. In Claude Desktop
  // chat there is no project tree → leave undefined so detect_framework returns
  // 'unknown' + the manual guide instead of scanning the launch directory.
  cwd: process.env.SEALMETRICS_PROJECT_DIR || undefined,
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
