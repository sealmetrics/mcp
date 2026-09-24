/** SealMetrics API error with user-friendly message. */
export class SealMetricsAPIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly userMessage: string,
    public readonly detail?: string,
  ) {
    super(userMessage);
    this.name = "SealMetricsAPIError";
  }
}

/** Map HTTP status codes to user-friendly error messages. */
export function mapHttpError(
  status: number,
  body: string,
  siteId?: string,
): SealMetricsAPIError {
  switch (status) {
    case 401:
      return new SealMetricsAPIError(
        401,
        "Invalid API key. Generate one at Settings > API Tokens in your SealMetrics dashboard.",
        body,
      );
    case 403: {
      // PRD-055 RF-A06: keep the API's own reason (e.g. "Required scope: one of
      // read, sites:read" vs "Access denied to account: X") so the model can tell
      // an insufficient scope from a site the key does not cover.
      const base = siteId
        ? `Access denied to site "${siteId}". Your API key may not have access to this site.`
        : "Access denied. Your API key does not have the required permissions.";
      const detail = extractDetail(body);
      return new SealMetricsAPIError(403, detail ? `${base} API said: ${detail}` : base, body);
    }
    case 404:
      return new SealMetricsAPIError(
        404,
        siteId
          ? `Site "${siteId}" not found. Use list_sites to see available sites.`
          : "Resource not found.",
        body,
      );
    case 400: {
      // Date-range errors are 400, not 422 (PRD-062 DEC-13): start > end, an
      // unknown period preset, a range over 730 days. They used to fall in the
      // default branch, which drops the reason — the model saw only "status
      // 400" and could not fix its own call (RF-036).
      const detail = extractDetail(body);
      return new SealMetricsAPIError(
        400,
        detail ? `Invalid request: ${detail}` : "API request failed with status 400.",
        body,
      );
    }
    case 422:
      return new SealMetricsAPIError(
        422,
        `Invalid request parameters: ${extractValidationMessage(body)}`,
        body,
      );
    case 429:
      return new SealMetricsAPIError(
        429,
        "Rate limit exceeded. Please wait a moment before retrying.",
        body,
      );
    default:
      if (status >= 500) {
        return new SealMetricsAPIError(
          status,
          "SealMetrics API is temporarily unavailable. Please try again later.",
          body,
        );
      }
      return new SealMetricsAPIError(
        status,
        `API request failed with status ${status}.`,
        body,
      );
  }
}

/**
 * The API's own reason for an error as a one-line string, or undefined when
 * the body is not JSON / carries none. The SealMetrics API wraps every
 * HTTPException as `{"error": {"code", "message", "detail"?}}` (main.py
 * http_exception_handler); a bare `{"detail": ...}` (FastAPI's default, still
 * used by some test doubles) is accepted too.
 */
function extractDetail(body: string): string | undefined {
  const asText = (value: unknown): string | undefined => {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const message = (value as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    return undefined;
  };
  try {
    const parsed = JSON.parse(body) as { error?: unknown; detail?: unknown };
    return asText(parsed.error) ?? asText(parsed.detail);
  } catch {
    return undefined;
  }
}

/**
 * A readable "field: reason" list out of a 422 body.
 *
 * Two shapes are handled. The SealMetrics API wraps every validation error as
 * `{"error": {"code": "validation_error", "detail": [{field, message, type}]}}`
 * (main.py `validation_exception_handler`); FastAPI's own default
 * `{"detail": [{loc, msg}]}` is still produced by some test doubles. Without
 * the first branch a 422 reached the model as the raw JSON blob — technically
 * complete, practically unreadable (PRD-062 RF-036).
 */
function extractValidationMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { detail?: unknown };
      detail?: unknown;
    };

    const wrapped = parsed.error?.detail;
    if (Array.isArray(wrapped)) {
      return wrapped
        .map(
          (d: { field?: string; message?: string }) =>
            `${d.field ?? "field"}: ${d.message ?? "invalid"}`,
        )
        .join("; ");
    }

    if (parsed.detail) {
      if (Array.isArray(parsed.detail)) {
        return parsed.detail
          .map(
            (d: { loc?: string[]; msg?: string }) =>
              `${d.loc?.join(".") ?? "field"}: ${d.msg ?? "invalid"}`,
          )
          .join("; ");
      }
      return String(parsed.detail);
    }
    return body;
  } catch {
    return body;
  }
}
