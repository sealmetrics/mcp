/**
 * Install plan model (PRD-058 B1). A plan is what the agent proposes to install —
 * loader, SPA mode, events, triggers, properties and examples — before any code is
 * written. `planInstall` validates it; the user approves it; `simulateInstall`
 * refuses a plan whose id no longer matches. Presentation-agnostic (RF-3103).
 */
import type { EventKind } from "../instrument.js";

export type Vertical = "ecommerce" | "hotel" | "saas" | "leadgen" | "content";

export type TriggerType = "page" | "click" | "submit" | "route" | "datalayer" | "code";

/** `pageview` is a manual `sealmetrics({ group })` call the agent will write. */
export type PlanEventKind = EventKind | "pageview";

export type PropertyType = "string" | "number" | "boolean" | "list";

export interface PropertySpec {
  /** The expression in the site's code (`product.id`). Read by humans, not evaluated. */
  source?: string;
  type?: PropertyType;
  /** Synthetic example; feeds the simulation. Never real customer data. */
  example?: unknown;
  /** For `list`: the most items one event can carry (drives the size estimate). */
  max_items?: number;
  /** For `list`: the item shape, `{ key: type }`. */
  item?: Record<string, Exclude<PropertyType, "list">>;
}

export interface PlanTrigger {
  type: TriggerType;
  /** File (`app/checkout/page.tsx`), selector or route. */
  where?: string;
  description?: string;
}

export interface PlanEventInput {
  kind: PlanEventKind;
  /** Taxonomy name for conv/micro; ignored for `pageview`. */
  name?: string;
  trigger?: PlanTrigger;
  /** Revenue argument of `conv()`. */
  value?: { source?: string; type?: string; example?: unknown };
  properties?: Record<string, PropertySpec>;
  /** Content group for a manual pageview. */
  group?: string;
}

export interface LoaderInput {
  /** File the snippet goes in. */
  file?: string;
  /** Exactly as `get_tracking_code` returned it. `auto` / `spa` flags are derived from it. */
  snippet_url: string;
  /** Queue stub inlined in <head> before the tracker. */
  stub?: boolean;
  /** Optional explicit flags; a contradiction with `snippet_url` is a finding (PL-16). */
  auto_pageview?: boolean;
  spa_pageview?: boolean;
}

export interface InstallPlanInput {
  account_id: string;
  vertical?: Vertical;
  repo_path?: string;
  site: { domain: string; framework?: string };
  loader: LoaderInput;
  events: PlanEventInput[];
  /** e.g. `{ key: "product_id", applies_to: ["view_item", "add_to_cart", "purchase.items"] }` */
  product_identifier?: { key: string; applies_to: string[] };
}

/** Loader after deriving flags from the snippet URL, exactly as pixel-service parses it. */
export interface NormalizedLoader {
  file?: string;
  snippet_url: string;
  origin: string | null;
  account_id_in_url: string | null;
  group: string;
  auto_pageview: boolean;
  spa_pageview: boolean;
  stub: boolean;
}

export interface NormalizedEvent {
  kind: PlanEventKind;
  name: string;
  trigger: PlanTrigger | null;
  value: { source?: string; type?: string; example?: unknown } | null;
  properties: Record<string, PropertySpec>;
  group?: string;
}

export interface NormalizedPlan {
  account_id: string;
  vertical: Vertical | null;
  site: { domain: string; framework: string | null };
  loader: NormalizedLoader;
  events: NormalizedEvent[];
  product_identifier: { key: string; applies_to: string[] } | null;
}

export type Severity = "block" | "warn" | "info";

export interface PlanFinding {
  code: string;
  severity: Severity;
  /** Event name, `loader`, `site` or `repo`. */
  event?: string;
  message: string;
  fix?: string;
}

export interface PlanResult {
  plan_id: string;
  status: "ok" | "blocked";
  findings: PlanFinding[];
  plan: NormalizedPlan;
  summary_markdown: string;
  files_to_edit: string[];
  estimate: { events: number; max_payload_bytes: number; payload_limit_bytes: number };
  checked: { site_domains: boolean; repo: boolean };
  next_step: string;
}

export interface PlanOptions {
  /** Domains of the site (`/sites`). `null` / omitted → PL-11 reported as not checked. */
  siteDomains?: string[] | null;
  /** Expected tracker origin; default `https://t.sealmetrics.com`. */
  trackerOrigin?: string;
}
