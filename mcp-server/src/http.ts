#!/usr/bin/env node
/**
 * Remote MCP entrypoint (Streamable HTTP) — RF-RMT10.
 *
 * Thin bootstrap: reads env config and wires `createRemoteApp()` (the testable
 * request handler) to two Node http servers — the public
 * one, served behind a reverse proxy, and a metrics server on a separate port
 * that is never routed publicly (RF-RMT42). The npm package `bin` remains the
 * stdio entrypoint (dist/index.js); this file runs only in the remote service.
 */
import { createServer as createHttpServer } from "node:http";
import { createRemoteApp } from "./remote/app.js";
import { Introspector } from "./remote/introspect.js";
import { RateLimiter } from "./remote/ratelimit.js";
import { Metrics } from "./remote/metrics.js";
import { createRequire } from "module";

let PKG_VERSION = "0.0.0";
try {
  const req = createRequire(import.meta.url);
  PKG_VERSION = (req("../package.json") as { version: string }).version ?? PKG_VERSION;
} catch {
  // standalone bundle — keep the fallback
}

const PORT = parseInt(process.env.MCP_HTTP_PORT ?? "8090", 10);
const METRICS_PORT = parseInt(process.env.MCP_METRICS_PORT ?? "9464", 10);
const PUBLIC_URL = (process.env.MCP_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, "");
const OAUTH_ISSUER = (process.env.OAUTH_ISSUER ?? "https://my.sealmetrics.com").replace(/\/+$/, "");
const API_BASE_URL = process.env.SEALMETRICS_BASE_URL ?? "https://my.sealmetrics.com/api/v1";
const INTROSPECTION_URL =
  process.env.MCP_INTROSPECTION_URL ?? `${API_BASE_URL}/internal/oauth/introspect`;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "";
const DASHBOARD_URL = (process.env.MCP_DASHBOARD_URL ?? OAUTH_ISSUER).replace(/\/+$/, "");

if (!INTERNAL_API_KEY) {
  console.error("[mcp-remote] FATAL: INTERNAL_API_KEY is required");
  process.exit(1);
}

// VAL-RMT10 — allowed hosts/origins for DNS-rebinding protection.
const allowedHosts = new Set(
  (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);
allowedHosts.add(new URL(PUBLIC_URL).host.toLowerCase());
allowedHosts.add(`localhost:${PORT}`);
allowedHosts.add(`127.0.0.1:${PORT}`);

const allowedOrigins = new Set(
  (
    process.env.MCP_ALLOWED_ORIGINS ??
    "https://claude.ai,https://claude.com,https://chatgpt.com,https://chat.openai.com"
  )
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\/+$/, ""))
    .filter(Boolean),
);
allowedOrigins.add(PUBLIC_URL.toLowerCase());

function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  // Structured JSON logs (RF-RMT42). Never include tokens or api keys.
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, service: "mcp-remote", msg, ...fields }) +
      "\n",
  );
}

const introspector = new Introspector({ url: INTROSPECTION_URL, internalKey: INTERNAL_API_KEY });
const rateLimiter = new RateLimiter({
  redisUrl: process.env.REDIS_URL,
  tokenLimit: parseInt(process.env.MCP_RATE_LIMIT_TOKEN_RPM ?? "120", 10),
  ipLimit: parseInt(process.env.MCP_RATE_LIMIT_IP_RPM ?? "300", 10),
});
const metrics = new Metrics();

const app = createRemoteApp(
  {
    publicUrl: PUBLIC_URL,
    oauthIssuer: OAUTH_ISSUER,
    apiBaseUrl: API_BASE_URL,
    dashboardUrl: DASHBOARD_URL,
    iconPath: process.env.MCP_ICON_PATH ?? "assets/icon.png",
    version: PKG_VERSION,
    maxBodyBytes: parseInt(process.env.MCP_MAX_BODY_BYTES ?? "262144", 10),
    allowedHosts,
    allowedOrigins,
    trustProxy: (process.env.MCP_TRUST_PROXY ?? "true") === "true",
  },
  {
    introspect: (token) => introspector.introspect(token),
    rateLimiter,
    metrics,
    log,
  },
);

const httpServer = createHttpServer(app);
const metricsServer = createHttpServer((req, res) => {
  if (req.method === "GET" && (req.url === "/metrics" || req.url === "/metrics/")) {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(metrics.render());
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

async function main(): Promise<void> {
  await rateLimiter.init();
  httpServer.listen(PORT, () => {
    log("info", "listening", { port: PORT, resource: `${PUBLIC_URL}/mcp`, issuer: OAUTH_ISSUER });
  });
  metricsServer.listen(METRICS_PORT, () => {
    log("info", "metrics listening", { port: METRICS_PORT });
  });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log("info", "shutting down", { signal });
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
