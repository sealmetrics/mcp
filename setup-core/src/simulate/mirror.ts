/**
 * Mirror of pixel-service event ingestion (PRD-058 C2). Given the body the tracker
 * posts, it answers the two questions a 204 hides: is the hit rejected, and if not,
 * what is stored. Each rule cites its Go origin; `fixtures/sim-contract/*.json` are
 * run through this module (setup-core/test/mirror.contract.test.ts) AND through the
 * Go code (pixel-service/internal/handler/mirror_contract_test.go), so a server
 * change that is not mirrored here fails CI on the server's own PR.
 *
 * Not mirrored, because they depend on production state: invalid_token (HMAC with
 * the server secret), blocklists, bot detection, rate limit, entrance dedup.
 */

/** `event.go` `maxEventBodyBytes` — `io.LimitReader(r.Body, 15*1024)`. */
export const MAX_EVENT_BODY_BYTES = 15 * 1024;

export type MirrorRejection = "invalid_json" | "invalid_account" | "invalid_domain";

export const NOT_MIRRORED = ["invalid_token", "blocklist_ip", "blocklist_ua", "bot_detected", "rate_limit", "duplicate_entrance"] as const;

export interface StoredEvent {
  /** `determineEventType`. */
  event_type: "pageview" | "conversion" | "microconversion";
  conversion_type: string;
  amount: number;
  is_micro: boolean;
  content_grouping: string;
  /** `FlexStringMap`: every value as the string that is stored. */
  properties: Record<string, string>;
}

export interface MirrorInput {
  /** Raw request body, as sent. */
  body: string;
  /** Default: `application/x-www-form-urlencoded`, what the tracker's URLSearchParams sets. */
  contentType?: string;
  /** Active accounts known to the cache. */
  accountIds: string[];
  /** Active domains of the account; `null` = unknown, the domain rule is skipped. */
  domains: string[] | null;
}

export interface MirrorResult {
  body_bytes: number;
  truncated: boolean;
  rejection: MirrorRejection | null;
  detail?: string;
  /** Decoded payload when the JSON parsed. */
  payload?: Record<string, unknown>;
  /** What pixel-service would store; absent when rejected. */
  stored_as?: StoredEvent;
  /** Rules that could not be evaluated with the inputs given. */
  unchecked: string[];
}

// ---------------------------------------------------------------------------
// Go `url.ParseQuery` + `QueryUnescape` (net/url): '&' separates pairs, a ';' in a
// pair is an error since Go 1.17, '+' is a space, '%' must be followed by 2 hex.
// Returns the first value of each key, or an error.
// ---------------------------------------------------------------------------
function goParseQuery(query: string): { values: Map<string, string>; error: string | null } {
  const values = new Map<string, string>();
  let error: string | null = null;
  for (const part of query.split("&")) {
    if (part === "") continue;
    if (part.includes(";")) {
      error ??= "invalid semicolon separator in query";
      continue;
    }
    const eq = part.indexOf("=");
    const rawKey = eq >= 0 ? part.slice(0, eq) : part;
    const rawValue = eq >= 0 ? part.slice(eq + 1) : "";
    const key = goQueryUnescape(rawKey);
    const value = goQueryUnescape(rawValue);
    if (key === null || value === null) {
      error ??= "invalid URL escape";
      continue;
    }
    if (!values.has(key)) values.set(key, value);
  }
  return { values, error };
}

function goQueryUnescape(s: string): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "%") {
      const hex = s.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else if (ch === "+") {
      bytes.push(0x20);
    } else {
      for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

// ---------------------------------------------------------------------------
// `json.Unmarshal` into `models.EventPayload`. A type mismatch on a known field is an
// error, and the handler turns any error into invalid_json.
// ---------------------------------------------------------------------------
const STRING_FIELDS = ["a", "s", "t", "u", "r", "z", "g", "e"] as const;

function goDecodePayload(json: string): { payload?: Record<string, unknown>; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { error: `invalid JSON: ${(e as Error).message}` };
  }
  if (raw === null) return { payload: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `cannot unmarshal ${Array.isArray(raw) ? "array" : typeof raw} into EventPayload` };
  }
  const p = raw as Record<string, unknown>;
  for (const f of STRING_FIELDS) {
    if (p[f] !== undefined && p[f] !== null && typeof p[f] !== "string") return { error: `field ${f}: expected string` };
  }
  if (p.c !== undefined && p.c !== null && !(typeof p.c === "number" && Number.isInteger(p.c))) {
    return { error: "field c: expected int64" };
  }
  if (p.v !== undefined && p.v !== null && typeof p.v !== "number") return { error: "field v: expected float64" };
  if (p.x !== undefined && p.x !== null && (typeof p.x !== "object" || Array.isArray(p.x))) {
    return { error: "field x: expected an object (FlexStringMap)" };
  }
  if (p.p !== undefined && p.p !== null) {
    if (typeof p.p !== "object" || Array.isArray(p.p) || Object.values(p.p as object).some((v) => typeof v !== "string" && v !== null)) {
      return { error: "field p: expected map[string]string" };
    }
  }
  return { payload: p };
}

/** `FlexBool.UnmarshalJSON`. */
function flexBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "true" || v === "1";
  return false;
}

/** Go `fmt.Sprintf("%g", f)` for a finite float64: shortest digits, exponent form when exp < -4 || exp >= 6. */
export function goFormatG(x: number): string {
  if (Object.is(x, -0)) return "-0";
  const [mant, expStr] = x.toExponential().split("e");
  const exp = Number(expStr);
  if (exp < -4 || exp >= 6) {
    const sign = exp < 0 ? "-" : "+";
    return `${mant}e${sign}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return String(x);
}

/** Go `encoding/json` Marshal of a value decoded into interface{}: sorted keys, HTML-safe strings. */
export function goJsonMarshal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(goJsonMarshal).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v as object).sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
    return `{${keys.map((k) => `${goJsonString(k)}:${goJsonMarshal((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  if (typeof v === "string") return goJsonString(v);
  return JSON.stringify(v);
}

function goJsonString(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** `models.FlexStringMap.UnmarshalJSON`. */
export function flexStringMap(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!x || typeof x !== "object" || Array.isArray(x)) return out;
  for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
    else if (typeof val === "number") {
      const asInt = Math.abs(val) < 2 ** 63 && Number.isInteger(val);
      out[k] = asInt ? BigInt(val).toString() : goFormatG(val);
    } else if (typeof val === "boolean") out[k] = String(val);
    else if (val === null) out[k] = "";
    else out[k] = goJsonMarshal(val);
  }
  return out;
}

/**
 * `extractDomainFromURL`: `url.Parse(raw).Hostname()` minus a leading "www.". Go keeps
 * the host's case, rejects control characters anywhere, rejects spaces or a non-numeric
 * port in the host, and finds a host only after "scheme://" or a leading "//".
 */
export function goExtractDomain(rawUrl: string): string {
  if (!rawUrl) return "";
  if (/[\x00-\x1f\x7f]/.test(rawUrl)) return "";
  const m = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\/([^/?#]*)/.exec(rawUrl);
  if (!m) return "";
  let host = m[1];
  const at = host.lastIndexOf("@");
  if (at >= 0) host = host.slice(at + 1);
  if (/\s/.test(host)) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end < 0) return "";
    const rest = host.slice(end + 1);
    if (rest && !/^:\d*$/.test(rest)) return "";
    host = host.slice(1, end);
  } else {
    const colon = host.indexOf(":");
    if (colon >= 0) {
      if (!/^\d*$/.test(host.slice(colon + 1))) return "";
      host = host.slice(0, colon);
    }
  }
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** `DomainCache.IsDomainAllowed`: exact match, else a listed domain is a parent. */
export function goIsDomainAllowed(domains: string[], domain: string): boolean {
  if (domains.length === 0) return false;
  if (domains.includes(domain)) return true;
  return domains.some((d) => domain.endsWith(`.${d}`));
}

export function mirrorEvent(input: MirrorInput): MirrorResult {
  const full = Buffer.from(input.body, "utf8");
  const truncated = full.length > MAX_EVENT_BODY_BYTES;
  const body = (truncated ? full.subarray(0, MAX_EVENT_BODY_BYTES) : full).toString("utf8");
  const result: MirrorResult = { body_bytes: full.length, truncated, rejection: null, unchecked: [...NOT_MIRRORED] };

  let json = body;
  const ct = input.contentType ?? "application/x-www-form-urlencoded";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const { values, error } = goParseQuery(body);
    const d = values.get("d") ?? "";
    if (error || d === "") {
      return { ...result, rejection: "invalid_json", detail: error ?? "form body has no d field" };
    }
    json = d;
  }

  const decoded = goDecodePayload(json);
  if (decoded.error) {
    return { ...result, rejection: "invalid_json", detail: truncated ? `body truncated at ${MAX_EVENT_BODY_BYTES} bytes: ${decoded.error}` : decoded.error };
  }
  const payload = decoded.payload!;
  result.payload = payload;

  const accountId = typeof payload.a === "string" ? payload.a : "";
  if (!accountId || !input.accountIds.includes(accountId)) {
    return { ...result, rejection: "invalid_account", detail: `account '${accountId}' is not active` };
  }

  if (input.domains === null) {
    result.unchecked.unshift("invalid_domain");
  } else {
    const domain = goExtractDomain(typeof payload.u === "string" ? payload.u : "");
    if (domain === "" || !goIsDomainAllowed(input.domains, domain)) {
      return { ...result, rejection: "invalid_domain", detail: `domain '${domain}' is not among the site's domains` };
    }
  }

  const e = typeof payload.e === "string" ? payload.e : "";
  const isMicro = flexBool(payload.m);
  result.stored_as = {
    event_type: e ? (isMicro ? "microconversion" : "conversion") : "pageview",
    conversion_type: e,
    amount: typeof payload.v === "number" ? payload.v : 0,
    is_micro: isMicro,
    content_grouping: typeof payload.g === "string" ? payload.g : "",
    properties: flexStringMap(payload.x),
  };
  return result;
}
