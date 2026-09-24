/**
 * Provisioning + pixel-status HTTP against the Fase 1 backend. Consumes, never
 * changes, the existing contract: POST /provision (X-Provision-Key) and
 * GET /sites/{id}/pixel/status (X-API-Key).
 *
 * Presentation-agnostic (RF-3103): on failure it throws a structured
 * {@link ProvisionError} carrying a stable `code`. The consumer maps that code to
 * its own surface — CLI exit codes (`mapProvisionError`) or MCP tool errors
 * (`AUTH_REQUIRED`, kill-switch). The api_key/claim token are never logged here
 * (VAL-3201 / VAL-3203 are enforced by callers; the core simply returns them).
 */
import type { PixelStatus, ProvisionResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/** Inputs to POST /provision. Mirrors the Fase 1 request body (minus presentation). */
export interface ProvisionInput {
  siteName: string;
  domain?: string;
  email: string;
  name?: string;
  /** Attribution channel: "npx" | "cli" | "mcp" | … (RF-3205 `install_source`). */
  installSource: string;
  timezone?: string;
}

export interface ProvisionOptions {
  baseUrl: string;
  provisionKey: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface PixelStatusOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Stable, transport-level error codes mapped by each consumer to its own surface. */
export type ProvisionErrorCode =
  | "AUTH_REQUIRED" // 401 — provision key invalid/revoked
  | "EMAIL_EXISTS" // 409 — account already exists for this email
  | "RATE_LIMITED" // 429
  | "PROVISIONING_DISABLED" // 503 — kill switch / flag off
  | "NETWORK" // could not reach the API
  | "BAD_RESPONSE" // 200 but malformed payload / invalid JSON
  | "BACKEND_ERROR"; // any other non-2xx

export class ProvisionError extends Error {
  readonly code: ProvisionErrorCode;
  readonly httpStatus?: number;
  readonly retryAfter?: number;
  readonly detail?: string;
  constructor(
    code: ProvisionErrorCode,
    message: string,
    opts?: { httpStatus?: number; retryAfter?: number; detail?: string },
  ) {
    super(message);
    this.name = "ProvisionError";
    this.code = code;
    this.httpStatus = opts?.httpStatus;
    this.retryAfter = opts?.retryAfter;
    this.detail = opts?.detail;
  }
}

/** Raised by {@link fetchPixelStatus} on a non-200 / network / malformed response. */
export class PixelStatusError extends Error {
  readonly httpStatus?: number;
  readonly detail?: string;
  constructor(message: string, opts?: { httpStatus?: number; detail?: string }) {
    super(message);
    this.name = "PixelStatusError";
    this.httpStatus = opts?.httpStatus;
    this.detail = opts?.detail;
  }
}

interface ApiResponseEnvelope<T> {
  success?: boolean;
  data?: T;
  detail?: unknown;
  [key: string]: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Build the POST /provision request body from the structured input. Shared by the
 * CLI (via {@link provision}) and the MCP write-path so the wire contract has a
 * single source (RF-3102/RF-3201).
 */
export function buildProvisionBody(input: ProvisionInput): Record<string, unknown> {
  return {
    site_name: input.siteName,
    domain: input.domain,
    email: input.email,
    name: input.name,
    accept_terms: true,
    install_source: input.installSource,
    timezone: input.timezone,
  };
}

/**
 * Map a non-2xx /provision HTTP status to a structured {@link ProvisionError}.
 * Shared so both transports (CLI raw fetch, MCP client.post) raise identical codes.
 */
export function provisionErrorForStatus(
  status: number,
  opts?: { retryAfter?: number; detail?: string },
): ProvisionError {
  if (status === 401) {
    return new ProvisionError("AUTH_REQUIRED", "The provision key was rejected (invalid or revoked).", {
      httpStatus: 401,
    });
  }
  if (status === 409) {
    return new ProvisionError("EMAIL_EXISTS", "An account already exists for this email.", {
      httpStatus: 409,
    });
  }
  if (status === 429) {
    return new ProvisionError("RATE_LIMITED", "Provisioning is rate-limited. Please wait and retry.", {
      httpStatus: 429,
      retryAfter: opts?.retryAfter,
    });
  }
  if (status === 503) {
    return new ProvisionError("PROVISIONING_DISABLED", "Provisioning is currently disabled on the server.", {
      httpStatus: 503,
    });
  }
  return new ProvisionError("BACKEND_ERROR", `Provisioning failed (HTTP ${status}).`, {
    httpStatus: status,
    detail: opts?.detail,
  });
}

/**
 * Validate + unwrap a 200 /provision envelope into a {@link ProvisionResult}.
 * Throws BAD_RESPONSE if account_id/api_key are missing. Shared (single source).
 */
export function unwrapProvisionData(json: unknown): ProvisionResult {
  const data = (json as ApiResponseEnvelope<ProvisionResult>)?.data;
  if (!data || !data.account_id || !data.api_key) {
    throw new ProvisionError("BAD_RESPONSE", "Provisioning returned an unexpected response.", {
      httpStatus: 200,
    });
  }
  return data;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ProvisionError("BAD_RESPONSE", "The API returned invalid JSON.", {
      httpStatus: res.status,
    });
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = parseInt(header, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * POST /provision. Returns the unwrapped {@link ProvisionResult} on 200, or throws
 * a {@link ProvisionError} whose `code` the consumer maps to its surface.
 */
export async function provision(
  input: ProvisionInput,
  options: ProvisionOptions,
): Promise<ProvisionResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body = buildProvisionBody(input);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${baseUrl}/provision`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Provision-Key": options.provisionKey,
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  } catch (e) {
    throw new ProvisionError("NETWORK", `Could not reach the SealMetrics API at ${baseUrl}.`, {
      detail: e instanceof Error ? e.message : undefined,
    });
  }

  if (res.status === 200) {
    return unwrapProvisionData(await readJson(res));
  }

  const detail = (await safeText(res)).slice(0, 200) || undefined;
  throw provisionErrorForStatus(res.status, {
    retryAfter: parseRetryAfter(res.headers.get("Retry-After")),
    detail,
  });
}

/**
 * GET /sites/{id}/pixel/status (single shot). Returns the unwrapped
 * {@link PixelStatus}; throws {@link PixelStatusError} on non-200 / network /
 * malformed response. The polling loop ({@link pollPixelStatus}) supplies retries.
 */
export async function fetchPixelStatus(
  accountId: string,
  options: PixelStatusOptions,
): Promise<PixelStatus> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl}/sites/${encodeURIComponent(accountId)}/pixel/status`;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      url,
      { method: "GET", headers: { "X-API-Key": options.apiKey, Accept: "application/json" } },
      timeoutMs,
    );
  } catch (e) {
    throw new PixelStatusError("Could not reach the SealMetrics API.", {
      detail: e instanceof Error ? e.message : undefined,
    });
  }

  if (res.status !== 200) {
    const detail = await safeText(res);
    throw new PixelStatusError(`Pixel status check failed (HTTP ${res.status}).`, {
      httpStatus: res.status,
      detail: detail.slice(0, 200) || undefined,
    });
  }

  const text = await res.text();
  let json: ApiResponseEnvelope<PixelStatus>;
  try {
    json = JSON.parse(text) as ApiResponseEnvelope<PixelStatus>;
  } catch {
    throw new PixelStatusError("Pixel status returned invalid JSON.");
  }
  const data = json.data;
  if (!data || typeof data.installed !== "boolean") {
    throw new PixelStatusError("Pixel status returned an unexpected response.");
  }
  return data;
}
