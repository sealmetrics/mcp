/**
 * Payload size estimate (PRD-058 PL-12). pixel-service reads at most 15 KB of body
 * (`event.go`, `io.LimitReader`); the tracker posts `d=<json>` url-encoded, which adds
 * roughly 45 %, and a truncated body is rejected as `invalid_json` with a 204. The
 * estimate builds the payload the tracker would send from the plan's examples, with
 * lists grown to `max_items`, and measures the encoded body.
 */
import type { NormalizedEvent, NormalizedPlan, PropertySpec } from "./types.js";

export const EVENT_BODY_LIMIT_BYTES = 15 * 1024;
export const EVENT_BODY_WARN_BYTES = 12 * 1024;

/** Same shape as a real token: base64url("<unix ts>:<32 hex>"), 60 chars. */
export const SAMPLE_TOKEN = Buffer.from(`1767225600:${"0".repeat(32)}`).toString("base64url");

const PLACEHOLDER: Record<string, unknown> = {
  string: "x".repeat(24),
  number: 12345.67,
  boolean: true,
};

function listItems(spec: PropertySpec, items: number, hints: Record<string, unknown>): unknown[] {
  let template: unknown;
  if (Array.isArray(spec.example) && spec.example.length > 0) {
    template = spec.example[0];
  } else if (spec.item) {
    template = Object.fromEntries(Object.entries(spec.item).map(([k, t]) => [k, hints[k] ?? PLACEHOLDER[t] ?? PLACEHOLDER.string]));
  } else {
    template = { product_id: PLACEHOLDER.string };
  }
  return Array.from({ length: items }, () => template);
}

/**
 * The `x` object for an event; lists carry `itemsOverride` items when given, else
 * `max_items`. `hints` fills item fields that have no example of their own, so a
 * synthetic purchase item carries the same `product_id` as the synthetic view_item.
 */
export function exampleProperties(
  event: NormalizedEvent,
  itemsOverride?: number,
  hints: Record<string, unknown> = {},
): Record<string, unknown> {
  const x: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(event.properties)) {
    if (spec.type === "list" || Array.isArray(spec.example)) {
      const n = itemsOverride ?? spec.max_items ?? (Array.isArray(spec.example) ? spec.example.length : 1);
      x[key] = listItems(spec, Math.max(0, n), hints);
    } else if (spec.example !== undefined) {
      x[key] = spec.example;
    } else {
      x[key] = PLACEHOLDER[spec.type ?? "string"] ?? PLACEHOLDER.string;
    }
  }
  return x;
}

/** Scalar examples declared anywhere in the plan, first one per key. */
export function exampleHints(plan: NormalizedPlan): Record<string, unknown> {
  const hints: Record<string, unknown> = {};
  for (const e of plan.events) {
    for (const [k, spec] of Object.entries(e.properties)) {
      if (!(k in hints) && spec.example !== undefined && typeof spec.example !== "object") hints[k] = spec.example;
    }
  }
  return hints;
}

/** Encoded body bytes of the event as the tracker would post it. */
export function estimateBodyBytes(plan: NormalizedPlan, event: NormalizedEvent, itemsOverride?: number): number {
  const url = `https://${plan.site.domain || "example.com"}/${"p".repeat(60)}`;
  const d: Record<string, unknown> = {
    a: plan.account_id,
    s: "1" + "9".repeat(10),
    t: SAMPLE_TOKEN,
    u: url,
    r: url,
    z: "Europe/Madrid",
    c: 1767225600000,
  };
  if (event.kind !== "pageview") {
    d.e = event.name;
    if (event.kind === "conv" && typeof event.value?.example === "number") d.v = event.value.example;
    if (event.kind === "micro") d.m = true;
    const x = exampleProperties(event, itemsOverride, exampleHints(plan));
    if (Object.keys(x).length) d.x = x;
  } else if (event.group) {
    d.g = event.group;
  }
  return Buffer.byteLength(new URLSearchParams({ d: JSON.stringify(d) }).toString(), "utf8");
}

/** Largest list length that stays under `limit`; `null` when the event has no list. */
export function maxItemsUnder(plan: NormalizedPlan, event: NormalizedEvent, limit: number): number | null {
  const hasList = Object.values(event.properties).some((s) => s.type === "list" || Array.isArray(s.example));
  if (!hasList) return null;
  let lo = 0;
  let hi = 2000;
  if (estimateBodyBytes(plan, event, 0) > limit) return 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateBodyBytes(plan, event, mid) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
