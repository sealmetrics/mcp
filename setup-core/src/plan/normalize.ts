/**
 * Plan normalization and identity (PRD-058 B1). The `plan_id` must not change when
 * the agent re-sends the same plan with keys or events in another order, and must
 * change on any real difference: canonical JSON (sorted keys, sorted events) → SHA-256.
 */
import { createHash } from "node:crypto";
import type {
  InstallPlanInput,
  NormalizedEvent,
  NormalizedLoader,
  NormalizedPlan,
  PlanEventInput,
  Vertical,
} from "./types.js";

const VERTICALS: readonly Vertical[] = ["ecommerce", "hotel", "saas", "leadgen", "content"];

/**
 * Parse a tracker URL the way `pixel-service/internal/handler/tracker.go` does:
 * `id` and `group` query params; `auto` / `spa` are "0" only when the param is
 * exactly "0", anything else (missing, empty, "false", "2") keeps them on.
 */
export function parseSnippetUrl(snippetUrl: string): {
  origin: string | null;
  pathname: string | null;
  id: string | null;
  group: string;
  auto: boolean;
  spa: boolean;
} {
  let url: URL;
  try {
    url = new URL(snippetUrl);
  } catch {
    // A bare `<script src=…>` tag pasted instead of the URL: pull the src out.
    const m = /src=["']([^"']+)["']/.exec(snippetUrl);
    if (m && m[1] !== snippetUrl) return parseSnippetUrl(m[1]);
    return { origin: null, pathname: null, id: null, group: "", auto: true, spa: true };
  }
  const q = url.searchParams;
  return {
    origin: url.origin,
    pathname: url.pathname,
    id: q.get("id"),
    group: q.get("group") ?? "",
    auto: q.get("auto") !== "0",
    spa: q.get("spa") !== "0",
  };
}

function normalizeLoader(input: InstallPlanInput["loader"]): NormalizedLoader {
  const parsed = parseSnippetUrl(String(input?.snippet_url ?? ""));
  const loader: NormalizedLoader = {
    snippet_url: String(input?.snippet_url ?? ""),
    origin: parsed.origin,
    account_id_in_url: parsed.id,
    group: parsed.group,
    auto_pageview: parsed.auto,
    spa_pageview: parsed.spa,
    stub: input?.stub === true,
  };
  if (input?.file) loader.file = String(input.file);
  return loader;
}

function normalizeEvent(e: PlanEventInput): NormalizedEvent {
  const kind = e.kind;
  const name = kind === "pageview" ? "pageview" : String(e.name ?? "").trim().toLowerCase();
  const out: NormalizedEvent = {
    kind,
    name,
    trigger: e.trigger ? { ...e.trigger } : null,
    value: e.value ? { ...e.value } : null,
    properties: { ...(e.properties ?? {}) },
  };
  if (e.group !== undefined) out.group = String(e.group);
  return out;
}

export function normalizePlan(input: InstallPlanInput): NormalizedPlan {
  const vertical = VERTICALS.includes(input.vertical as Vertical) ? (input.vertical as Vertical) : null;
  const domain = String(input.site?.domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return {
    account_id: String(input.account_id ?? "").trim(),
    vertical,
    site: { domain, framework: input.site?.framework ? String(input.site.framework) : null },
    loader: normalizeLoader(input.loader),
    events: (input.events ?? []).map(normalizeEvent),
    product_identifier: input.product_identifier
      ? { key: String(input.product_identifier.key), applies_to: [...(input.product_identifier.applies_to ?? [])].map(String) }
      : null,
  };
}

/** JSON with object keys sorted at every level; array order kept. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** `plan_id`: first 12 hex of SHA-256 over the canonical plan, events in a stable order. */
export function computePlanId(plan: NormalizedPlan): string {
  const events = [...plan.events].sort((a, b) => {
    const ka = canonicalJson([a.kind, a.name, a.trigger?.where ?? "", a]);
    const kb = canonicalJson([b.kind, b.name, b.trigger?.where ?? "", b]);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return createHash("sha256").update(canonicalJson({ ...plan, events })).digest("hex").slice(0, 12);
}
