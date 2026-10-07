import { VALID_PERIODS } from "../types.js";

export const PERIOD_SCHEMA = {
  type: "string",
  description: `Time period for the report. Examples: "today", "yesterday", "7d", "30d", "90d", "this_month", "last_month", "this_year". Default: "30d". For an arbitrary custom range (e.g. a specific past week), use start_date/end_date instead.`,
  enum: [...VALID_PERIODS],
  default: "30d",
} as const;

export const START_DATE_SCHEMA = {
  type: "string",
  description:
    'Custom range start date "YYYY-MM-DD" (an account-timezone local day). Provide together with end_date as an alternative to period for arbitrary ranges (e.g. a specific past week). When both dates are given, period is ignored.',
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
} as const;

export const END_DATE_SCHEMA = {
  type: "string",
  description:
    'Custom range end date "YYYY-MM-DD" (inclusive, account-timezone local day). Provide together with start_date.',
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date-range params shared by every stats tool: a custom start/end range or a
 * `period` preset (default "30d").
 *
 * The API gives `period` precedence over explicit dates, but the tools default
 * `period` client-side — sending both would silently override a custom range
 * with "30d". So when both dates are provided the period is NOT sent (the
 * custom range wins, as the schema descriptions promise). Dates are passed
 * through verbatim: the API interprets them as account-local days (never
 * resolved client-side: the API resolves every period in the account's timezone).
 */
export function dateRangeParams(args: Record<string, unknown>): {
  period?: string;
  start_date?: string;
  end_date?: string;
} {
  const start = args.start_date as string | undefined;
  const end = args.end_date as string | undefined;
  if (start || end) {
    if (!start || !end) {
      throw new Error(
        "start_date and end_date must be provided together (YYYY-MM-DD). For open-ended ranges use a period preset.",
      );
    }
    if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
      throw new Error("start_date and end_date must be formatted YYYY-MM-DD.");
    }
    if (start > end) {
      throw new Error("start_date must be on or before end_date.");
    }
    return { start_date: start, end_date: end };
  }
  return { period: (args.period as string) ?? "30d" };
}

export const COMPARE_SCHEMA = {
  type: "string",
  description:
    'Comparison mode. "previous" compares with the prior period of the same length. "yoy" compares with the same dates last year.',
  enum: ["previous", "yoy"],
} as const;

export const LIMIT_SCHEMA = {
  type: "number",
  description: "Maximum number of rows to return (default: 20, max: 100).",
  default: 20,
} as const;

export const SORT_ORDER_SCHEMA = {
  type: "string",
  description: 'Sort direction: "asc" or "desc" (default: "desc").',
  enum: ["asc", "desc"],
  default: "desc",
} as const;

export const PAGE_SCHEMA = {
  type: "number",
  description: "Page number for paginated results (default: 1).",
  default: 1,
} as const;

// ---------------------------------------------------------------------------
// Country filter (PRD-062 DEC-03 / DEC-07 / RF-031)
// ---------------------------------------------------------------------------

/**
 * Same rule the API enforces: an ISO-3166-1 alpha-2 code or the literal
 * `Unknown` the pixel writes when the browser's timezone maps to no country
 * (the country dimension comes from the timezone, never from the IP). Case
 * insensitive. Mirrors `COUNTRY_FILTER_PATTERN` in
 * `api/src/sealmetrics_api/models/filters.py`.
 */
const COUNTRY_FILTER_RE = /^([a-z]{2}|unknown)$/i;

const COUNTRY_ERROR =
  "country must be an ISO-3166-1 alpha-2 code (e.g. ES for Spain) or 'Unknown'; " +
  "call get_countries to see the codes with traffic";

export const COUNTRY_SCHEMA = {
  type: "string",
  description:
    "Filter by country: ISO-3166-1 alpha-2 code (e.g. 'ES' for Spain, 'US'), or 'Unknown' for traffic whose browser timezone maps to no country. Not the country name.",
} as const;

/** One value or a list of them (PRD-062 RF-034) — see `jsonSchemaToZod`. */
export const COUNTRY_ARRAY_SCHEMA = {
  anyOf: [
    { type: "string", minLength: 1 },
    { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
  ],
  description:
    "Filter by country code: ISO-3166-1 alpha-2 (e.g. 'ES' or ['ES', 'US']), or 'Unknown' for traffic whose browser timezone maps to no country. Not country names.",
} as const;

/** ISO codes upper-cased, `unknown` in any casing as the exact literal. */
function normalizeCountry(value: string): string {
  return value.toLowerCase() === "unknown" ? "Unknown" : value.toUpperCase();
}

/**
 * Validate `args.country` before the request leaves the MCP (DEC-07).
 *
 * The MCP does NOT translate names to codes: it says what is wrong and lets
 * the model correct itself, so both layers tell the same story. Returns the
 * normalized value, or undefined when the argument is absent.
 *
 * @throws Error naming the expected format, surfaced to the model as a tool
 *   error, when the value is neither an ISO-2 code nor `Unknown`.
 */
export function countryParam(args: Record<string, unknown>): string | undefined {
  const value = args.country;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !COUNTRY_FILTER_RE.test(value)) {
    throw new Error(`Invalid country "${String(value)}": ${COUNTRY_ERROR}.`);
  }
  return normalizeCountry(value);
}

/**
 * Multi-value variant for the tools whose API parameter repeats
 * (`?country=ES&country=PT`). Accepts a single string too.
 */
export function countryListParam(args: Record<string, unknown>): string[] | undefined {
  const value = args.country;
  if (value === undefined || value === null) return undefined;
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) return undefined;
  for (const item of values) {
    if (typeof item !== "string" || !COUNTRY_FILTER_RE.test(item)) {
      throw new Error(`Invalid country "${String(item)}": ${COUNTRY_ERROR}.`);
    }
  }
  return (values as string[]).map(normalizeCountry);
}

export const LANDING_PAGE_SCHEMA = {
  type: "string",
  description:
    "Restrict to sessions that entered on this landing path (exact match, case-insensitive; the trailing slash matters), as landing paths appear in the landing page reports.",
} as const;

export const LANDING_PAGE_ARRAY_SCHEMA = {
  anyOf: [
    { type: "string", minLength: 1 },
    { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
  ],
  description:
    "Filter by entry path, exact match, case-insensitive (e.g. '/camisetas-personalizadas/' or a list of paths). The trailing slash matters, as landing paths appear in the landing page reports.",
} as const;

/**
 * The `site_id` argument, shared by every site-scoped tool. Worded for both
 * transports: a remote grant that covers one site applies it automatically,
 * and SEALMETRICS_SITE_ID only exists on the local stdio server.
 */
export const SITE_ID_SCHEMA = {
  type: "string",
  description:
    "Site ID (the site_id / account_id of a site the connection covers). Omit it only when the connection has a default site: a hosted connection that covers exactly one site, or a local server started with SEALMETRICS_SITE_ID.",
} as const;

const STDIO_SITE_ID_HINT =
  "Either pass it as a parameter or set the SEALMETRICS_SITE_ID environment variable.";

let siteIdHint = STDIO_SITE_ID_HINT;
let siteIdEnvFallback = true;

/**
 * Adapt `resolveSiteId` to the transport (PRD-043 RF-005). Called once at boot
 * by the remote entrypoint; the stdio entrypoint leaves the defaults alone.
 *
 * The remote transport has no SEALMETRICS_SITE_ID: mentioning it there sends
 * the model chasing an env var it cannot set, instead of calling `list_sites`.
 * It also turns the env fallback OFF, so a stray SEALMETRICS_SITE_ID in the
 * container can never silently redirect a tenant's tool call.
 */
export function configureSiteIdResolution(options: {
  hint?: string;
  useEnvFallback?: boolean;
}): void {
  if (options.hint !== undefined) siteIdHint = options.hint;
  if (options.useEnvFallback !== undefined) siteIdEnvFallback = options.useEnvFallback;
}

/**
 * Resolve site_id from tool args (or the SEALMETRICS_SITE_ID env var on stdio).
 * Throws a transport-appropriate guide message if neither is available.
 */
export function resolveSiteId(args: Record<string, unknown>): string {
  const siteId =
    (args.site_id as string | undefined) ??
    (siteIdEnvFallback ? process.env.SEALMETRICS_SITE_ID : undefined);
  if (!siteId) {
    throw new Error(`site_id is required. ${siteIdHint}`);
  }
  return siteId;
}
