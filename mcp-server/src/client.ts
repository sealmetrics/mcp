import { mapHttpError, SealMetricsAPIError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1_000;

/** Raw JSON response from the API before envelope unwrapping. */
export interface RawAPIResponse {
  success: boolean;
  data: unknown;
  // Paginated responses have these at top level
  total?: number;
  page?: number;
  page_size?: number;
  has_next?: boolean;
  has_prev?: boolean;
  comparison?: unknown;
  totals?: unknown;
  [key: string]: unknown;
}

export class SealMetricsClient {
  /**
   * Read-only api_key (X-API-Key). Optional + mutable so the server can start in
   * setup-only mode without a key (RF-3202) and adopt the key returned by
   * provision_site at runtime to enable the read-only tools (RF-3202b). Held in
   * memory only — never echoed to the model or logs (VAL-3201).
   */
  private apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(apiKey: string | undefined, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** True once a read-only api_key is available (env at boot or post-provision). */
  hasApiKey(): boolean {
    return typeof this.apiKey === "string" && this.apiKey.length > 0;
  }

  /** Return the in-memory api_key (for setup-core verify). Never logged by callers. */
  getApiKey(): string | undefined {
    return this.apiKey;
  }

  /** Adopt the api_key returned by provision_site so read-only tools work (RF-3202b). */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Authenticated POST (RF-3201). The client was GET-only in v1.2.0; the
   * write-path needs it. NOT auto-retried — POST is not idempotent (a blind retry
   * of /provision could create duplicate accounts). Authenticates with the
   * publishable provision key (`provisionKey`) for provisioning, or X-API-Key
   * otherwise. On 2xx returns the parsed JSON; on non-2xx / network throws
   * SealMetricsAPIError carrying the status code for the caller to map.
   */
  async post<T>(
    path: string,
    body: unknown,
    opts?: { provisionKey?: string },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (opts?.provisionKey) {
      headers["X-Provision-Key"] = opts.provisionKey;
    } else if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SealMetricsAPIError(0, "Request timed out after 30 seconds.");
      }
      throw new SealMetricsAPIError(0, error instanceof Error ? error.message : "Network error");
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (!response.ok) {
      throw mapHttpError(response.status, text);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SealMetricsAPIError(response.status, "API returned invalid JSON.", text.slice(0, 500));
    }
  }

  /**
   * Authenticated PATCH (PRD-035 CHG-014: channel-rule draft edits).
   * Same contract as post(): no auto-retry, throws SealMetricsAPIError.
   */
  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("PATCH", path, body);
  }

  /**
   * Authenticated DELETE (PRD-035 CHG-014: channel-rule draft deletion).
   * Tolerates empty 204 bodies.
   */
  async del(path: string): Promise<void> {
    await this.send<unknown>("DELETE", path, undefined);
  }

  private async send<T>(method: string, path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SealMetricsAPIError(0, "Request timed out after 30 seconds.");
      }
      throw new SealMetricsAPIError(0, error instanceof Error ? error.message : "Network error");
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (!response.ok) {
      throw mapHttpError(response.status, text);
    }
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SealMetricsAPIError(response.status, "API returned invalid JSON.", text.slice(0, 500));
    }
  }

  /**
   * Send an authenticated GET request. Unwraps the API envelope
   * and returns just the `data` field.
   */
  async request<T>(
    path: string,
    params?: Record<string, string | string[] | undefined>,
  ): Promise<T> {
    const raw = await this.requestRaw(path, params);
    return raw.data as T;
  }

  /**
   * Send an authenticated GET request and return the full JSON body
   * without unwrapping. Use this for endpoints that don't use the
   * standard APIResponse envelope (e.g. alerts, webhooks).
   */
  async requestDirect<T>(
    path: string,
    params?: Record<string, string | string[] | undefined>,
  ): Promise<T> {
    const raw = await this.requestRaw(path, params);
    return raw as unknown as T;
  }

  /**
   * Send an authenticated GET request and return the full response
   * including pagination fields (total, page, has_next, etc.).
   * Use this for paginated endpoints.
   */
  async requestPaginated<T>(
    path: string,
    params?: Record<string, string | string[] | undefined>,
  ): Promise<{
    data: T[];
    total: number;
    page: number;
    page_size: number;
    has_next: boolean;
    comparison?: unknown;
    totals?: unknown;
  }> {
    const raw = await this.requestRaw(path, params);
    const result: {
      data: T[];
      total: number;
      page: number;
      page_size: number;
      has_next: boolean;
      comparison?: unknown;
      totals?: unknown;
    } = {
      data: raw.data as T[],
      total: raw.total ?? 0,
      page: raw.page ?? 1,
      page_size: raw.page_size ?? 0,
      has_next: raw.has_next ?? false,
    };
    if (raw.comparison != null) result.comparison = raw.comparison;
    if (raw.totals != null) result.totals = raw.totals;
    return result;
  }

  private async requestRaw(
    path: string,
    params?: Record<string, string | string[] | undefined>,
  ): Promise<RawAPIResponse> {
    // Defense in depth (RF-3202/RF-3602): without an api_key the read-only tools
    // are never registered, but if one is somehow invoked, fail with a clear
    // AUTH_REQUIRED instead of sending an unauthenticated request.
    if (!this.apiKey) {
      throw new SealMetricsAPIError(
        401,
        "AUTH_REQUIRED: a SealMetrics api_key is required for data tools. " +
          "Provision a site first (provision_site) or set SEALMETRICS_API_KEY.",
      );
    }
    const apiKey = this.apiKey;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          // Multi-value: append each entry as a repeated query param
          // (FastAPI deserializes `?k=a&k=b` into a list[str]).
          for (const item of value) {
            if (item !== undefined && item !== "") {
              url.searchParams.append(key, item);
            }
          }
        } else if (value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        DEFAULT_TIMEOUT_MS,
      );

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            "X-API-Key": apiKey,
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        if (response.ok) {
          const text = await response.text();
          try {
            return JSON.parse(text) as RawAPIResponse;
          } catch {
            throw new SealMetricsAPIError(
              response.status,
              "API returned invalid JSON.",
              text.slice(0, 500),
            );
          }
        }

        const body = await response.text();

        // Retry on 429 (respect Retry-After) or 5xx
        if (response.status === 429 || response.status >= 500) {
          if (response.status === 429) {
            const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
            if (retryAfter > 0) {
              await sleep(retryAfter);
            }
          }
          lastError = mapHttpError(response.status, body);
          continue;
        }

        // Non-retryable error
        const siteIdRaw =
          params?.["site_id"] ?? params?.["account_id"] ?? undefined;
        const siteId =
          typeof siteIdRaw === "string" ? siteIdRaw : undefined;
        throw mapHttpError(response.status, body, siteId);
      } catch (error) {
        if (error instanceof SealMetricsAPIError) {
          throw error;
        }
        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          lastError = new SealMetricsAPIError(
            0,
            "Request timed out after 30 seconds.",
          );
          continue;
        }
        lastError =
          error instanceof Error
            ? error
            : new Error("Unknown error occurred");
        // Network errors are retryable
        continue;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw (
      lastError ??
      new SealMetricsAPIError(0, "Request failed after retries.")
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds > 0 && seconds <= 120) {
    return seconds * 1000;
  }
  return 0;
}
