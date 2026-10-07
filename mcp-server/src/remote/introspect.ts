/**
 * OAuth token introspection client (RF-RMT11 / RF-RMT26 consumer side).
 *
 * The remote transport never validates tokens itself: it resolves the incoming
 * `Authorization: Bearer` token against the API's internal introspection
 * endpoint, reachable only from inside the deployment and authenticated
 * service-to-service. The API caches positive lookups briefly, so a revoked
 * token stops working without this process holding any per-replica state.
 *
 * The resolved api_key is held per-request only and never logged or echoed.
 */

const INTROSPECT_TIMEOUT_MS = 10_000;

export interface IntrospectionResult {
  active: boolean;
  /**
   * Default site — present ONLY when the connection resolves to exactly one
   * site right now (PRD-043 DEC-09), whether that is a single-site selection
   * or an "all my sites" grant on a user who happens to have one. Absent for
   * multi-site connections: there the model must name a `site_id` (DEC-04).
   *
   * It is a hint for the default injection, never an authorization: the API
   * re-resolves the grant's sites on every request from the per-grant api_key.
   */
  account_id?: string;
  /**
   * Sites of a manual selection (the snapshot taken at consent time), or the
   * single resolved site of an "all sites" grant. Empty for a multi-site
   * "all sites" grant — the list is deliberately not sent so the cached
   * response doesn't grow with a 100-site org (VAL-010).
   */
  account_ids?: string[];
  /** True when the user approved "all my sites" (dynamic, includes future ones). */
  all_sites?: boolean;
  /** How many sites the connection covers right now. */
  site_count?: number;
  /** OAuth scopes granted (e.g. ["analytics:read"]). */
  scopes?: string[];
  /** Server-side read-only api_key the tools use against the public API. */
  api_key?: string;
  client_id?: string;
}

export class IntrospectionError extends Error {
  constructor(
    message: string,
    /** True when the API was unreachable/5xx — surface as 503, not 401. */
    public readonly unavailable: boolean = false,
  ) {
    super(message);
    this.name = "IntrospectionError";
  }
}

export interface IntrospectorOptions {
  /** The API's internal introspection endpoint, resolved from configuration. */
  url: string;
  internalKey: string;
  fetchImpl?: typeof fetch;
}

export class Introspector {
  private readonly url: string;
  private readonly internalKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: IntrospectorOptions) {
    this.url = opts.url;
    this.internalKey = opts.internalKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async introspect(token: string): Promise<IntrospectionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INTROSPECT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": this.internalKey,
        },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
    } catch {
      // Network error / timeout — the AS is unreachable, not the token invalid.
      throw new IntrospectionError("introspection endpoint unreachable", true);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 500) {
      throw new IntrospectionError(`introspection failed: ${response.status}`, true);
    }
    if (!response.ok) {
      // 4xx (bad internal key, malformed) — treat as inactive token but flag
      // config errors loudly for the operator.
      if (response.status === 403 || response.status === 503) {
        console.error(
          `[mcp-remote] introspection rejected (${response.status}) — check INTERNAL_API_KEY configuration`,
        );
        throw new IntrospectionError("introspection misconfigured", true);
      }
      return { active: false };
    }

    try {
      const body = (await response.json()) as IntrospectionResult;
      return body.active ? body : { active: false };
    } catch {
      throw new IntrospectionError("introspection returned invalid JSON", true);
    }
  }
}
