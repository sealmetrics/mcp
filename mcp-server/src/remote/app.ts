/**
 * Remote transport request handler (RF-RMT10/11/12, VAL-RMT10/11).
 *
 * Framework-free request listener with injected dependencies so the auth
 * middleware and endpoints are unit-testable (TEST-RMT01) without booting the
 * real process. `http.ts` wires this to env config.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "../server.js";
import { REMOTE_EXCLUDED_TOOLS } from "./gate.js";
import { IntrospectionError, type IntrospectionResult } from "./introspect.js";
import type { RateLimiter } from "./ratelimit.js";
import type { Metrics } from "./metrics.js";
import { createOpenAICompatTools } from "./openai-tools.js";
import { configureSiteIdResolution } from "../tools/shared.js";

export interface RemoteAppConfig {
  /** Public base URL of this service, e.g. https://mcp.sealmetrics.com */
  publicUrl: string;
  /** OAuth issuer (AS), e.g. https://my.sealmetrics.com */
  oauthIssuer: string;
  /** API base the tools call, e.g. http://api-1:8000/api/v1 */
  apiBaseUrl: string;
  /** Dashboard base for citation links in search/fetch results. */
  dashboardUrl: string;
  /** Filesystem path of the server icon PNG (optional; served at /icon.png). */
  iconPath?: string;
  version: string;
  maxBodyBytes: number;
  /** Lowercased `host` header values accepted (VAL-RMT10). */
  allowedHosts: ReadonlySet<string>;
  /** Lowercased origins accepted when an Origin header is present. */
  allowedOrigins: ReadonlySet<string>;
  trustProxy: boolean;
}

export interface RemoteAppDeps {
  introspect: (token: string) => Promise<IntrospectionResult>;
  rateLimiter: Pick<RateLimiter, "check">;
  metrics: Metrics;
  log: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

/** RF-009: grant shape for metrics — no per-account cardinality. */
function grantType(auth: IntrospectionResult): "single" | "multi" | "all" {
  if (auth.all_sites) return "all";
  const count = auth.site_count ?? auth.account_ids?.length ?? (auth.account_id ? 1 : 0);
  return count > 1 ? "multi" : "single";
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on("data", (chunk: Buffer) => {
      if (overflowed) return; // keep draining so the 413 can be delivered
      size += chunk.length;
      if (size > maxBytes) {
        overflowed = true;
        chunks.length = 0;
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!overflowed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/**
 * MCP `instructions` for the remote transport (PRD-043 RF-005, DEC-04
 * reinforced).
 *
 * A remote connection may cover one site or a hundred, and the client reads
 * these instructions ONCE at `initialize` while the transport is stateless per
 * request — a connection can go from 1 to N sites mid-session (DEC-09). So the
 * text is static and covers both cases; the runtime safety net is the guide
 * message `resolveSiteId` throws when a tool is called without `site_id`.
 *
 * The point of the last two sentences: with a 100-site org the model must ASK,
 * not fan out over every site. Comparing two or three sites the user named is
 * still the expected behavior.
 */
const REMOTE_INSTRUCTIONS =
  "This connection may cover one or several SealMetrics sites. Every tool call targets exactly ONE site (`site_id`); when the connection covers a single site it is applied automatically. Call `list_sites` to learn their names. If the user has not made clear which site they mean, ASK before querying — never pick one yourself and never fan out over all sites. Querying two or three sites the user named explicitly (e.g. to compare them) is fine: one call per named site.";

const SITE_ID_REMOTE_HINT =
  "Pass site_id explicitly; call list_sites to see the sites this connection covers.";

const KNOWN_PATHS: ReadonlySet<string> = new Set([
  "/mcp",
  "/healthz",
  "/icon.png",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);

export function createRemoteApp(config: RemoteAppConfig, deps: RemoteAppDeps) {
  const resource = `${config.publicUrl}/mcp`;

  // RF-005: remote tools have no SEALMETRICS_SITE_ID to fall back on, and the
  // "missing site_id" error must point the model at list_sites instead.
  configureSiteIdResolution({ hint: SITE_ID_REMOTE_HINT, useEnvFallback: false });

  // Server icon (MCP `icons` metadata): loaded once at boot, served at /icon.png.
  let iconBuffer: Buffer | null = null;
  if (config.iconPath) {
    try {
      iconBuffer = readFileSync(config.iconPath);
    } catch {
      deps.log("warn", "icon not found, /icon.png disabled", { iconPath: config.iconPath });
    }
  }
  const iconUrl = iconBuffer ? `${config.publicUrl}/icon.png` : undefined;
  const resourceMetadataUrl = `${config.publicUrl}/.well-known/oauth-protected-resource/mcp`;

  const protectedResourceMetadata = {
    resource,
    authorization_servers: [config.oauthIssuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["analytics:read"],
    resource_name: "SealMetrics Analytics",
    resource_documentation: "https://sealmetrics.com/docs/mcp",
  };

  function unauthorized(res: ServerResponse, description: string): void {
    // RFC 9728 §5.1: point the client at the protected-resource metadata so it
    // can discover the Authorization Server and start the OAuth flow.
    sendJson(
      res,
      401,
      { error: "unauthorized", error_description: description },
      {
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}", error="invalid_token", error_description="${description}"`,
        // Browser-based MCP clients must be able to read the discovery header.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    );
  }

  function clientIp(req: IncomingMessage): string {
    if (config.trustProxy) {
      const forwarded = req.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded.length > 0) {
        // Exactly ONE trusted hop (Traefik) fronts this service and it APPENDS
        // the real client IP — take the RIGHTMOST entry. The leftmost is
        // attacker-controlled (per-IP rate-limit spoofing, AUD-RMT01 F1).
        const entries = forwarded.split(",");
        return entries[entries.length - 1].trim();
      }
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  function validateHostAndOrigin(req: IncomingMessage): string | null {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!config.allowedHosts.has(host)) {
      return `Host '${host}' not allowed`;
    }
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.length > 0) {
      if (!config.allowedOrigins.has(origin.toLowerCase().replace(/\/+$/, ""))) {
        return `Origin '${origin}' not allowed`;
      }
    }
    return null;
  }

  async function handleMcpPost(
    req: IncomingMessage,
    res: ServerResponse,
    auth: IntrospectionResult,
    rawBody: string,
  ): Promise<void> {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error: invalid JSON" },
        id: null,
      });
      return;
    }

    const isToolCall =
      typeof parsedBody === "object" &&
      parsedBody !== null &&
      (parsedBody as { method?: string }).method === "tools/call";
    if (isToolCall) deps.metrics.recordToolCall();

    // Stateless (Decision 7): fresh McpServer + transport per request; replicas
    // share nothing.
    const { server } = buildServer({
      apiKey: auth.api_key,
      baseUrl: config.apiBaseUrl,
      provisionKey: "", // setup tools are omitted in remote mode (VAL-RMT11)
      version: config.version,
      omitSetupTools: true,
      excludeReadOnlyTools: REMOTE_EXCLUDED_TOOLS,
      // ChatGPT connectors REQUIRE search+fetch, so they are registered for
      // every grant (RF-006). Without an accountId they resolve the site from
      // the query / the result id instead of from a fixed one.
      extraReadOnlyTools: createOpenAICompatTools({
        accountId: auth.account_id,
        dashboardUrl: config.dashboardUrl,
      }),
      iconUrl,
      instructions: REMOTE_INSTRUCTIONS,
      // PRD-043 RF-005/DEC-09: a default only exists when the connection
      // resolves to exactly ONE site (introspection then returns account_id).
      // With several sites there is no default — the model must name the site
      // (DEC-04) and resolveSiteId's guide message says how.
      defaultSiteId: auth.account_id,
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  }

  return function requestListener(req: IncomingMessage, res: ServerResponse): void {
    void (async () => {
      const started = process.hrtime.bigint();
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      // Metrics label must be a KNOWN route: recording raw attacker-controlled
      // paths would grow the counter Map / Prometheus cardinality without bound.
      const metricPath = KNOWN_PATHS.has(path) ? path : "unmatched";
      let status = 500;

      try {
        // CORS preflight for browser-based MCP clients (e.g. MCP Inspector):
        // the OAuth discovery runs in the browser. Public metadata + Bearer
        // auth, no cookies — a permissive preflight is safe.
        if (req.method === "OPTIONS" && KNOWN_PATHS.has(path)) {
          status = 204;
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers":
              "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
            "Access-Control-Max-Age": "86400",
          });
          res.end();
          return;
        }

        if (req.method === "GET" && path === "/healthz") {
          status = 200;
          sendJson(res, 200, { status: "ok", version: config.version });
          return;
        }

        if (req.method === "GET" && path === "/icon.png" && iconBuffer) {
          status = 200;
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": String(iconBuffer.length),
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(iconBuffer);
          return;
        }

        if (
          req.method === "GET" &&
          (path === "/.well-known/oauth-protected-resource" ||
            path === "/.well-known/oauth-protected-resource/mcp")
        ) {
          status = 200;
          sendJson(res, 200, protectedResourceMetadata, {
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
          });
          return;
        }

        if (path !== "/mcp") {
          status = 404;
          sendJson(res, 404, { error: "not_found" });
          return;
        }

        // --- /mcp ---
        const hostError = validateHostAndOrigin(req);
        if (hostError) {
          status = 403;
          deps.log("warn", "host/origin rejected", { reason: hostError, ip: clientIp(req) });
          sendJson(res, 403, { error: "forbidden", error_description: hostError });
          return;
        }

        if (req.method !== "POST") {
          // Stateless mode: no standalone SSE stream (GET) and no session to delete.
          status = 405;
          sendJson(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
          return;
        }

        const authHeader = req.headers.authorization;
        const match = typeof authHeader === "string" ? authHeader.match(/^Bearer\s+(.+)$/i) : null;
        if (!match) {
          status = 401;
          deps.metrics.recordAuthFailure("missing_token");
          unauthorized(res, "Missing Bearer token");
          return;
        }
        const token = match[1].trim();

        const ip = clientIp(req);
        const rate = await deps.rateLimiter.check(token, ip);
        if (!rate.allowed) {
          status = 429;
          deps.metrics.recordRateLimited();
          sendJson(res, 429, { error: "rate_limited" }, { "Retry-After": String(rate.retryAfter) });
          return;
        }

        let auth: IntrospectionResult;
        try {
          auth = await deps.introspect(token);
        } catch (error) {
          if (error instanceof IntrospectionError && error.unavailable) {
            status = 503;
            deps.metrics.recordAuthFailure("introspection_error");
            sendJson(res, 503, { error: "temporarily_unavailable" }, { "Retry-After": "5" });
            return;
          }
          throw error;
        }
        // PRD-043: `account_id` is no longer required — a multi-site grant
        // deliberately has none (RF-004). Requiring it here is exactly what
        // makes an OLD mcp-remote 401 a new multi-site grant, hence the
        // deploy order in the PRD (dashboard last).
        if (!auth.active || !auth.api_key) {
          status = 401;
          deps.metrics.recordAuthFailure("invalid_token");
          unauthorized(res, "Token is invalid, expired, or revoked");
          return;
        }
        deps.metrics.recordGrantType(grantType(auth));

        let rawBody: string;
        try {
          rawBody = await readBody(req, config.maxBodyBytes);
        } catch {
          status = 413;
          sendJson(res, 413, { error: "payload_too_large" }, { Connection: "close" });
          return;
        }

        await handleMcpPost(req, res, auth, rawBody);
        status = res.statusCode;
      } catch (error) {
        deps.log("error", "unhandled error", {
          path,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent) {
          sendJson(res, 500, { error: "internal_error" });
        }
        status = 500;
      } finally {
        const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
        deps.metrics.recordRequest(req.method ?? "?", metricPath, status);
        if (path === "/mcp") deps.metrics.recordLatency(elapsed);
        if (path !== "/healthz") {
          deps.log("info", "request", {
            method: req.method,
            path,
            status,
            duration_ms: Math.round(elapsed * 1000),
          });
        }
      }
    })();
  };
}
