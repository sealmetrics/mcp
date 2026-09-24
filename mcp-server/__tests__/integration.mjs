#!/usr/bin/env node

/**
 * Integration test: sends MCP JSON-RPC messages to the server via stdio.
 * Usage: SEALMETRICS_API_KEY=sm_xxx SEALMETRICS_BASE_URL=http://localhost:8001/api/v1 node __tests__/integration.mjs
 */

import { spawn } from "child_process";

const API_KEY = process.env.SEALMETRICS_API_KEY;
const BASE_URL = process.env.SEALMETRICS_BASE_URL || "http://localhost:8001/api/v1";

if (!API_KEY) {
  console.error("SEALMETRICS_API_KEY is required");
  process.exit(1);
}

const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, SEALMETRICS_API_KEY: API_KEY, SEALMETRICS_BASE_URL: BASE_URL },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
let responseResolve;
let requestId = 0;

server.stdout.on("data", (data) => {
  buffer += data.toString();
  // MCP uses newline-delimited JSON
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (responseResolve) {
        responseResolve(msg);
        responseResolve = null;
      }
    } catch { /* skip non-JSON lines */ }
  }
});

server.stderr.on("data", (data) => {
  const text = data.toString().trim();
  if (text) console.error("[stderr]", text);
});

function send(msg) {
  return new Promise((resolve) => {
    responseResolve = resolve;
    server.stdin.write(JSON.stringify(msg) + "\n");
  });
}

async function rpc(method, params = {}) {
  const id = ++requestId;
  const result = await send({ jsonrpc: "2.0", id, method, params });
  return result;
}

async function callTool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  return result;
}

// --- Run tests ---

const results = { passed: 0, failed: 0 };

function assert(name, condition, detail) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    results.passed++;
  } else {
    console.log(`  FAIL: ${name} - ${detail || ""}`);
    results.failed++;
  }
}

async function runTests() {
  console.log("\n=== MCP Server Integration Tests ===\n");
  console.log(`Base URL: ${BASE_URL}`);

  // 1. Initialize
  console.log("\n--- Initialize ---");
  const initResult = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  });
  assert("Server initializes", initResult.result?.serverInfo?.name === "sealmetrics",
    JSON.stringify(initResult.result?.serverInfo));

  // Send initialized notification
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await new Promise((r) => setTimeout(r, 200));

  // 2. List tools
  console.log("\n--- List Tools ---");
  const toolsResult = await rpc("tools/list", {});
  const toolNames = (toolsResult.result?.tools || []).map((t) => t.name);
  assert("Has 12 tools", toolNames.length === 12, `got ${toolNames.length}: ${toolNames.join(", ")}`);
  assert("Has list_sites", toolNames.includes("list_sites"));
  assert("Has get_overview", toolNames.includes("get_overview"));
  assert("Has get_funnel", toolNames.includes("get_funnel"));

  // 3. list_sites
  console.log("\n--- list_sites ---");
  const sitesResult = await callTool("list_sites");
  const sitesContent = sitesResult.result?.content?.[0]?.text;
  let sites;
  try {
    sites = JSON.parse(sitesContent);
  } catch { sites = null; }
  assert("Returns valid JSON", sites !== null, sitesContent?.substring(0, 100));
  assert("Returns array of sites", Array.isArray(sites), typeof sites);
  if (sites?.length > 0) {
    assert("Sites have site_id", !!sites[0].site_id, JSON.stringify(sites[0]));
    assert("Sites have domains", Array.isArray(sites[0].domains));
    console.log(`  Found ${sites.length} site(s): ${sites.map((s) => s.site_id).join(", ")}`);
  }

  // Use the first site for remaining tests
  const siteId = sites?.[0]?.site_id;
  if (!siteId) {
    console.log("\nNo sites found - skipping data tests");
    finish();
    return;
  }

  // 4. get_overview
  console.log("\n--- get_overview ---");
  const overviewResult = await callTool("get_overview", { site_id: siteId, period: "30d" });
  const overviewContent = overviewResult.result?.content?.[0]?.text;
  const isError = overviewResult.result?.isError;
  let overview;
  try { overview = JSON.parse(overviewContent); } catch { overview = null; }
  if (isError) {
    console.log(`  WARN: get_overview returned error: ${overviewContent?.substring(0, 200)}`);
  } else {
    assert("Overview returns JSON", overview !== null, overviewContent?.substring(0, 100));
    assert("Has traffic data", overview?.traffic !== undefined, JSON.stringify(Object.keys(overview || {})));
    assert("Has entrances", typeof overview?.traffic?.entrances === "number");
    assert("Has bounce_rate", typeof overview?.traffic?.bounce_rate === "number");
    console.log(`  Traffic: ${overview?.traffic?.entrances} entrances, ${overview?.traffic?.page_views} pageviews, bounce: ${overview?.traffic?.bounce_rate}%`);
  }

  // 5. get_traffic_sources
  console.log("\n--- get_traffic_sources ---");
  const sourcesResult = await callTool("get_traffic_sources", { site_id: siteId, period: "30d", limit: 5 });
  const sourcesContent = sourcesResult.result?.content?.[0]?.text;
  const sourcesError = sourcesResult.result?.isError;
  let sources;
  try { sources = JSON.parse(sourcesContent); } catch { sources = null; }
  if (sourcesError) {
    console.log(`  WARN: get_traffic_sources returned error: ${sourcesContent?.substring(0, 200)}`);
  } else {
    assert("Sources returns data", sources !== null);
    assert("Sources has paginated shape", Array.isArray(sources?.data) && typeof sources?.total === "number", JSON.stringify(Object.keys(sources || {})));
    if (sources?.data?.length > 0) {
      console.log(`  Top sources: ${sources.data.slice(0, 3).map((s) => `${s.utm_source || s.source} (${s.entrances})`).join(", ")}`);
      console.log(`  Pagination: ${sources.data.length} of ${sources.total} (has_next: ${sources.has_next})`);
    }
  }

  // 6. get_pages
  console.log("\n--- get_pages ---");
  const pagesResult = await callTool("get_pages", { site_id: siteId, period: "30d", limit: 5 });
  const pagesContent = pagesResult.result?.content?.[0]?.text;
  const pagesError = pagesResult.result?.isError;
  let pages;
  try { pages = JSON.parse(pagesContent); } catch { pages = null; }
  if (pagesError) {
    console.log(`  WARN: get_pages returned error: ${pagesContent?.substring(0, 200)}`);
  } else {
    assert("Pages returns data", pages !== null);
    assert("Pages has paginated shape", Array.isArray(pages?.data) && typeof pages?.total === "number", JSON.stringify(Object.keys(pages || {})));
    if (pages?.data?.length > 0) {
      console.log(`  Top pages: ${pages.data.slice(0, 3).map((p) => `${p.path} (${p.page_views} pvs)`).join(", ")}`);
    }
  }

  // 7. get_conversions
  console.log("\n--- get_conversions ---");
  const convResult = await callTool("get_conversions", { site_id: siteId, period: "30d" });
  const convContent = convResult.result?.content?.[0]?.text;
  const convError = convResult.result?.isError;
  if (convError) {
    console.log(`  WARN: get_conversions returned error: ${convContent?.substring(0, 200)}`);
  } else {
    let convData;
    try { convData = JSON.parse(convContent); } catch { convData = null; }
    assert("Conversions returns data", convData !== null);
    console.log(`  Conversions: ${Array.isArray(convData) ? convData.length : "N/A"} types`);
  }

  // 8. get_devices
  console.log("\n--- get_devices ---");
  const devResult = await callTool("get_devices", { site_id: siteId, period: "30d" });
  const devContent = devResult.result?.content?.[0]?.text;
  const devError = devResult.result?.isError;
  if (devError) {
    console.log(`  WARN: get_devices returned error: ${devContent?.substring(0, 200)}`);
  } else {
    let devData;
    try { devData = JSON.parse(devContent); } catch { devData = null; }
    assert("Devices returns JSON", devData !== null);
    assert("Has by_device", devData?.by_device !== undefined);
    assert("Has by_browser", devData?.by_browser !== undefined);
    assert("Has by_os", devData?.by_os !== undefined);
    if (devData?.by_device) {
      console.log(`  Devices: ${devData.by_device.map((d) => `${d.name} (${d.entrances})`).join(", ")}`);
    }
  }

  // 9. get_countries
  console.log("\n--- get_countries ---");
  const geoResult = await callTool("get_countries", { site_id: siteId, period: "30d", limit: 5 });
  const geoContent = geoResult.result?.content?.[0]?.text;
  const geoError = geoResult.result?.isError;
  if (geoError) {
    console.log(`  WARN: get_countries returned error: ${geoContent?.substring(0, 200)}`);
  } else {
    let geoData;
    try { geoData = JSON.parse(geoContent); } catch { geoData = null; }
    assert("Countries returns data", geoData !== null);
    if (Array.isArray(geoData) && geoData.length > 0) {
      console.log(`  Top countries: ${geoData.slice(0, 3).map((c) => `${c.country} (${c.entrances})`).join(", ")}`);
    }
  }

  // 10. get_landing_pages
  console.log("\n--- get_landing_pages ---");
  const lpResult = await callTool("get_landing_pages", { site_id: siteId, period: "30d", limit: 5 });
  const lpContent = lpResult.result?.content?.[0]?.text;
  const lpError = lpResult.result?.isError;
  if (lpError) {
    console.log(`  WARN: get_landing_pages returned error: ${lpContent?.substring(0, 200)}`);
  } else {
    let lpData;
    try { lpData = JSON.parse(lpContent); } catch { lpData = null; }
    assert("Landing pages returns data", lpData !== null);
    if (Array.isArray(lpData) && lpData.length > 0) {
      console.log(`  Top landing pages: ${lpData.slice(0, 3).map((p) => `${p.path} (${p.entrances} entr, ${p.bounce_rate}% bounce)`).join(", ")}`);
    }
  }

  // 11. Error handling: site_id missing
  console.log("\n--- Error handling ---");
  const errResult = await callTool("get_overview", {});
  assert("Missing site_id returns error", errResult.result?.isError === true);
  assert("Error mentions site_id", errResult.result?.content?.[0]?.text?.includes("site_id"));

  finish();
}

function finish() {
  console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===\n`);
  server.kill();
  process.exit(results.failed > 0 ? 1 : 0);
}

// Timeout safety
setTimeout(() => {
  console.error("Test timed out after 30s");
  server.kill();
  process.exit(1);
}, 30000);

runTests().catch((err) => {
  console.error("Test failed:", err);
  server.kill();
  process.exit(1);
});
