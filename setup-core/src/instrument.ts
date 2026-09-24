/**
 * Event-instrumentation helpers (Fase 3 Bloque 4). The agent writes
 * `sealmetrics.conv()` / `sealmetrics.micro()`; setup-core provides the closed
 * taxonomy validation (VAL-3401) and the PII gate (VAL-3402) the verifier uses
 * before declaring an event "good". Presentation-agnostic: returns structured
 * results, throws nothing for validation outcomes.
 *
 * Single source: the taxonomy below mirrors the canonical asset
 * `integrations/prompts/sealmetrics-implementation-prompt.md` ("Reference"
 * section). `test/instrument.test.ts` asserts the asset still lists exactly these
 * names so the two never drift.
 */

/** Closed conversion taxonomy (asset "Conversions" reference list). */
export const CONV_TYPES = ["purchase", "lead", "signup", "subscription", "booking"] as const;

/**
 * Closed microconversion taxonomy. Mirrors every micro event name USED in the
 * canonical asset — the reference list plus the names shown only in the per-vertical
 * examples (`article_read`, `feature_use`). Keeping these in sync means the verifier
 * never rejects an event the guide told the agent to write (audit HIGH-2).
 */
export const MICRO_TYPES = [
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "form_submit",
  "newsletter_signup",
  "cta_click",
  "video_play",
  "video_complete",
  "scroll_50",
  "scroll_100",
  "file_download",
  "search",
  "404_error",
  "article_read",
  "feature_use",
] as const;

export type ConvType = (typeof CONV_TYPES)[number];
export type MicroType = (typeof MICRO_TYPES)[number];
export type EventKind = "conv" | "micro";

export interface TaxonomyResult {
  valid: boolean;
  /** Closest in-taxonomy name when `valid` is false (best-effort). */
  suggestion?: string;
}

/**
 * Validate an event name against the closed taxonomy for its kind (VAL-3401).
 * A name outside the list is flagged (not silently accepted), with a best-effort
 * suggestion of the closest known name.
 */
export function validateEventName(kind: EventKind, name: string): TaxonomyResult {
  const known = kind === "conv" ? (CONV_TYPES as readonly string[]) : (MICRO_TYPES as readonly string[]);
  const normalized = String(name ?? "").trim().toLowerCase();
  if (known.includes(normalized)) {
    return { valid: true };
  }
  return { valid: false, suggestion: closest(normalized, known) };
}

function closest(name: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  // Only suggest when reasonably close (avoid noise on totally unrelated names).
  return best !== undefined && bestScore <= Math.max(3, Math.floor(name.length / 2)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[n];
}

/** A property flagged as likely PII (VAL-3402 / RF-3402). */
export interface PiiFinding {
  key: string;
  /** Why it was flagged: forbidden key name, or a value that looks like PII. */
  reason: "forbidden_key" | "email_value" | "phone_value" | "id_value";
}

/**
 * Property keys that must never be instrumented (RF-3402). Matched
 * case-insensitively. Tightened (audit HIGH-1) so guide-canonical, non-PII keys
 * like `product_name`, `form_name`, `file_name`, `order_total`, `order_status`,
 * `transaction_amount`, `video_id` are NOT flagged — only person-identifying names
 * and the *id/number* of an order/transaction/user trip the gate.
 */
const FORBIDDEN_KEY_PATTERNS: RegExp[] = [
  /(^|_)e?mail($|_)/i,
  /(^|_)phone($|_)/i,
  /(^|_)tel($|_)/i,
  /^name$/i, // a bare `name` is almost always a person's name
  /(^|_)(first|last|full|given|sur|customer|user|client|member|contact|company)_?name($|_)/i,
  /(^|_)address($|_)/i, // ip_address, billing_address, email_address…
  /(^|_)(order|transaction|invoice|receipt)_?(id|no|number|num)($|_)/i, // id/number REQUIRED
  /(^|_)(user|customer|client|member|account)_?id($|_)/i,
  /\buid\b/i,
  /(^|_)ssn($|_)/i,
  /(^|_)dob($|_)/i,
  /(^|_)ip($|_)/i,
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\s\-().]?){9,}/; // 9+ digits with separators → likely a phone

/**
 * Product identifiers are long digit runs by design (EAN-13, GTIN-14, numeric SKUs)
 * and matched PHONE_RE, so `view_item { product_id: "8412345678905" }` was reported
 * as a phone (PRD-058). Their values skip the phone rule only; the email rule and
 * the key rules still apply.
 */
const PRODUCT_ID_KEY = /^(product_id|item_id|content_id|sku|ean|gtin|upc|mpn|isbn|variant_id)$/i;
const looksLikePhone = (key: string, value: string) => !PRODUCT_ID_KEY.test(key) && PHONE_RE.test(value);

/**
 * Inspect an event's properties for likely PII (VAL-3402). Flags both forbidden
 * KEY names (order_id, email, customer_id…) and forbidden VALUE shapes (an email
 * or phone-looking string under an otherwise innocent key). Numbers/booleans are
 * never values-scanned. Used by the verifier to reject before declaring success.
 */
export function detectPII(properties: Record<string, unknown> | undefined | null): PiiFinding[] {
  if (!properties || typeof properties !== "object") return [];
  const findings: PiiFinding[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (FORBIDDEN_KEY_PATTERNS.some((re) => re.test(key))) {
      findings.push({ key, reason: "forbidden_key" });
      continue;
    }
    if (typeof value === "string") {
      if (EMAIL_RE.test(value)) {
        findings.push({ key, reason: "email_value" });
      } else if (looksLikePhone(key, value)) {
        findings.push({ key, reason: "phone_value" });
      }
    }
  }
  return findings;
}

/**
 * Recursive PII scan (PRD-058 A3). {@link detectPII} only sees top-level keys, so an
 * `order_id` inside `items[]` passes it. This walks objects and arrays, and parses a
 * string that holds JSON (`FlexStringMap` stores `items` as a JSON string), applying
 * the same key and value rules at every level. `key` is the path: `items[0].order_id`.
 */
export function detectPIIDeep(value: unknown, path = ""): PiiFinding[] {
  if (typeof value === "string") {
    const t = value.trim();
    if ((t.startsWith("{") || t.startsWith("[")) && t.length > 1) {
      try {
        return detectPIIDeep(JSON.parse(t), path);
      } catch {
        /* not JSON: fall through to the value rules */
      }
    }
    if (!path) return [];
    if (EMAIL_RE.test(value)) return [{ key: path, reason: "email_value" }];
    const leaf = path.replace(/\[\d+\]$/, "").split(".").pop() ?? "";
    if (looksLikePhone(leaf, value)) return [{ key: path, reason: "phone_value" }];
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => detectPIIDeep(v, `${path}[${i}]`));
  }
  if (!value || typeof value !== "object") return [];
  const findings: PiiFinding[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const p = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEY_PATTERNS.some((re) => re.test(key))) {
      findings.push({ key: p, reason: "forbidden_key" });
      continue;
    }
    findings.push(...detectPIIDeep(v, p));
  }
  return findings;
}

export interface InstrumentationCheck {
  ok: boolean;
  taxonomy: TaxonomyResult;
  pii: PiiFinding[];
}

/**
 * One-shot validation of a single instrumented event: name in taxonomy AND no PII
 * in properties. `ok` is the hard gate (RF-3402: privacy is non-negotiable).
 */
export function checkInstrumentation(
  kind: EventKind,
  name: string,
  properties?: Record<string, unknown> | null,
): InstrumentationCheck {
  const taxonomy = validateEventName(kind, name);
  const pii = detectPII(properties);
  return { ok: taxonomy.valid && pii.length === 0, taxonomy, pii };
}
