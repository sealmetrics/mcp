/**
 * Plan rules PL-01…PL-17 (PRD-058 B2). Deterministic, no model, no network: site
 * domains arrive through options and the repository is read through `scanRepo`.
 * Each rule names the code or document it protects; severities follow the source
 * PRD (sealmetrics/seal-copilot docs/PRD-plan-simulate-v1.md, E2).
 */
import { detectPIIDeep, validateEventName } from "../instrument.js";
import type { RepoScan } from "./repo.js";
import { EVENT_BODY_LIMIT_BYTES, EVENT_BODY_WARN_BYTES, estimateBodyBytes, maxItemsUnder } from "./size.js";
import type { NormalizedEvent, NormalizedPlan, PlanFinding, PlanOptions, PropertySpec } from "./types.js";

/** Conversions that carry revenue by definition: without an amount they are counted at 0. */
const REVENUE_CONVERSIONS = new Set(["purchase", "subscription"]);

const FUNNELS: Record<string, string[]> = {
  ecommerce: ["view_item", "add_to_cart", "begin_checkout", "purchase"],
  hotel: ["view_item", "begin_checkout", "booking"],
  saas: ["signup"],
  leadgen: ["lead"],
  content: [],
};

export const DEFAULT_TRACKER_ORIGIN = "https://t.sealmetrics.com";

type Rule = (plan: NormalizedPlan, ctx: RuleContext) => PlanFinding[];

export interface RuleContext {
  options: PlanOptions;
  repo: RepoScan | null;
}

const tracked = (plan: NormalizedPlan) => plan.events.filter((e) => e.kind !== "pageview");

/** Property names as an object the PII scan can walk, list items included; values left empty. */
function keyShape(properties: Record<string, PropertySpec>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([k, spec]) => {
      if (spec.item) return [k, [Object.fromEntries(Object.keys(spec.item).map((ik) => [ik, ""]))]];
      if (Array.isArray(spec.example) && spec.example[0] && typeof spec.example[0] === "object") {
        return [k, [Object.fromEntries(Object.keys(spec.example[0] as object).map((ik) => [ik, ""]))]];
      }
      return [k, ""];
    }),
  );
}

export const PL01_taxonomy: Rule = (plan) =>
  tracked(plan).flatMap((e) => {
    const r = validateEventName(e.kind as "conv" | "micro", e.name);
    if (r.valid) return [];
    return [{
      code: "PL-01",
      severity: "block",
      event: e.name,
      message: `'${e.name}' is not in the closed ${e.kind} taxonomy; verify_event_instrumented rejects it as out_of_taxonomy.`,
      fix: r.suggestion ? `Use '${r.suggestion}', with what distinguishes it in a property.` : "Pick a name from get_instrumentation_guide and put the distinction in a property.",
    }];
  });

export const PL02_piiKeys: Rule = (plan) =>
  plan.events.flatMap((e) =>
    detectPIIDeep(keyShape(e.properties))
      .filter((f) => f.reason === "forbidden_key")
      .map((f) => ({
        code: "PL-02",
        severity: "block" as const,
        event: e.name,
        message: `Property '${f.key}' identifies a person or an order. Sealmetrics is consentless because no event carries identifiers.`,
        fix: `Remove '${f.key}'. To avoid counting a purchase twice, key a sessionStorage flag on the order id in the browser without sending it.`,
      })),
  );

export const PL03_piiExamples: Rule = (plan) =>
  plan.events.flatMap((e) => {
    const examples: Record<string, unknown> = Object.fromEntries(
      Object.entries(e.properties).filter(([, s]) => s.example !== undefined).map(([k, s]) => [k, s.example]),
    );
    if (e.value?.example !== undefined) examples.value = e.value.example;
    return detectPIIDeep(examples)
      .filter((f) => f.reason !== "forbidden_key")
      .map((f) => ({
        code: "PL-03",
        severity: "block" as const,
        event: e.name,
        message: `The example for '${f.key}' looks like ${f.reason === "email_value" ? "an email address" : "a phone number"}. Examples must be synthetic, and a real value here would be sent as-is.`,
        fix: "Replace it with a synthetic value.",
      }));
  });

export const PL04_revenue: Rule = (plan) =>
  tracked(plan)
    .filter((e) => e.kind === "conv")
    .flatMap((e): PlanFinding[] => {
      if (!e.value) {
        if (!REVENUE_CONVERSIONS.has(e.name)) return [];
        return [{
          code: "PL-04",
          severity: "block" as const,
          event: e.name,
          message: `'${e.name}' has no revenue. It would be stored with amount 0 and every later recommendation would count conversions instead of euros.`,
          fix: `Declare value: sealmetrics.conv('${e.name}', <number>, {...}).`,
        }];
      }
      const declared = e.value.type;
      const example = e.value.example;
      if ((declared !== undefined && declared !== "number") || typeof example === "string") {
        return [{
          code: "PL-04",
          severity: "warn" as const,
          event: e.name,
          message: `The revenue for '${e.name}' is ${typeof example === "string" ? `a string in the example ('${example}')` : `declared as ${declared}`}. The tracker only sends an amount whose typeof is 'number', so a string arrives with revenue 0 and no error.`,
          fix: `sealmetrics.conv('${e.name}', Number(${e.value.source ?? "total"}), …)`,
        }];
      }
      return [];
    });

export const PL05_currency: Rule = (plan) =>
  tracked(plan)
    .filter((e) => e.kind === "conv" && e.value && e.value.example !== 0 && !("currency" in e.properties))
    .map((e) => ({
      code: "PL-05",
      severity: "warn" as const,
      event: e.name,
      message: `'${e.name}' carries revenue without a currency property.`,
      fix: "Add currency (ISO 4217, e.g. 'EUR').",
    }));

export const PL06_productIdentifier: Rule = (plan) => {
  const vertical = plan.vertical;
  const productEvents = tracked(plan).filter((e) => e.name === "view_item" || e.name === "add_to_cart");
  if (!productEvents.length) return [];
  const severity = vertical === "ecommerce" ? ("block" as const) : ("warn" as const);
  const pi = plan.product_identifier;
  if (!pi) {
    return [{
      code: "PL-06",
      severity,
      event: productEvents[0].name,
      message: "No product_identifier. Per-SKU analysis joins view_item, add_to_cart and purchase items on one key with one value; without it, product-friction is impossible.",
      fix: "Declare product_identifier: { key: 'product_id', applies_to: ['view_item', 'add_to_cart', 'purchase.items'] }.",
    }];
  }
  const findings: PlanFinding[] = [];
  const exampleValues = new Map<string, string>();
  for (const target of pi.applies_to) {
    const [eventName, listKey] = target.split(".");
    const events = plan.events.filter((e) => e.name === eventName);
    if (!events.length) continue;
    for (const e of events) {
      const has = listKey
        ? Boolean(e.properties[listKey]?.item?.[pi.key] !== undefined ||
            (Array.isArray(e.properties[listKey]?.example) &&
              (e.properties[listKey]!.example as unknown[]).some((it) => it && typeof it === "object" && pi.key in (it as object))))
        : pi.key in e.properties;
      const example = listKey
        ? (Array.isArray(e.properties[listKey]?.example)
            ? ((e.properties[listKey]!.example as Record<string, unknown>[])[0]?.[pi.key] as unknown)
            : undefined)
        : e.properties[pi.key]?.example;
      if (example !== undefined && typeof example !== "object") exampleValues.set(target, String(example));
      if (!has) {
        findings.push({
          code: "PL-06",
          severity,
          event: e.name,
          message: `'${target}' does not carry '${pi.key}', so it cannot be joined with the other product events.`,
          fix: `Add '${pi.key}' to ${listKey ? `each item of ${listKey}` : "its properties"}, with the same value as on view_item.`,
        });
      }
    }
  }
  if (new Set(exampleValues.values()).size > 1) {
    findings.push({
      code: "PL-06",
      severity: "warn",
      event: pi.applies_to[0].split(".")[0],
      message: `The examples give '${pi.key}' different values (${[...exampleValues.entries()].map(([t, v]) => `${t}=${v}`).join(", ")}). The same product must carry the same value on every event, or per-SKU joins break.`,
    });
  }
  return findings;
};

export const PL07_duplicates: Rule = (plan) => {
  const seen = new Map<string, number>();
  for (const e of plan.events) {
    const k = `${e.kind}:${e.name}:${e.trigger?.where ?? ""}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([k, n]) => {
      const [, name, where] = k.split(":");
      return {
        code: "PL-07",
        severity: "warn" as const,
        event: name,
        message: `'${name}' is planned ${n} times${where ? ` at ${where}` : ""}; each one sends its own event.`,
      };
    });
};

export const PL08_doublePageview: Rule = (plan) => {
  const manual = plan.events.filter((e) => e.kind === "pageview");
  const findings: PlanFinding[] = [];
  if (plan.loader.spa_pageview && manual.some((e) => e.trigger?.type === "route")) {
    findings.push({
      code: "PL-08",
      severity: "block",
      event: "pageview",
      message: "Manual pageviews on route changes while the tracker also records History API navigations (spa=1): every navigation counts twice (PRD-034).",
      fix: "Remove the manual route pageview, or load the tracker with &spa=0 and keep it.",
    });
  }
  if (plan.loader.auto_pageview && manual.some((e) => e.trigger?.type === "page")) {
    findings.push({
      code: "PL-08",
      severity: "block",
      event: "pageview",
      message: "A manual pageview on page load while the tracker also sends one (auto=1): every page counts twice.",
      fix: "Remove the manual load pageview, or load the tracker with &auto=0 and keep it.",
    });
  }
  return findings;
};

export const PL09_missingPageviews: Rule = (plan) => {
  const manual = plan.events.filter((e) => e.kind === "pageview");
  const findings: PlanFinding[] = [];
  if (!plan.loader.auto_pageview && !manual.some((e) => e.trigger?.type !== "route")) {
    findings.push({
      code: "PL-09",
      severity: "block",
      event: "pageview",
      message: "The tracker loads with auto=0 and no manual pageview is planned for page load: the site would record no pageviews.",
      fix: "Plan a sealmetrics({ group }) call on load, or drop &auto=0.",
    });
  }
  if (!plan.loader.spa_pageview && !manual.some((e) => e.trigger?.type === "route")) {
    findings.push({
      code: "PL-09",
      severity: "warn",
      event: "pageview",
      message: "The tracker loads with spa=0 and no route pageview is planned: client-side navigations are not counted. Fine only if the site is not a single-page app.",
    });
  }
  return findings;
};

export const PL10_stub: Rule = (plan) => {
  if (plan.loader.stub) return [];
  return plan.events
    .filter((e) => e.trigger && (e.trigger.type === "datalayer" || e.trigger.type === "code"))
    .map((e) => ({
      code: "PL-10",
      severity: "warn" as const,
      event: e.name,
      message: `'${e.name}' fires from ${e.trigger!.type === "datalayer" ? "a data layer / tag manager" : "code"} that can run before the deferred tracker loads: sealmetrics is not defined, and the event is lost.`,
      fix: "Inline the queue stub in <head> before the tracker (stub: true).",
    }));
};

export const PL11_domain: Rule = (plan, ctx) => {
  const domains = ctx.options.siteDomains;
  if (domains === undefined || domains === null) {
    return [{
      code: "PL-11",
      severity: "info",
      event: "site",
      message: "The site's domains were not available, so whether pixel-service accepts hits from this domain was not checked.",
    }];
  }
  // Exactly IsDomainAllowed: "www." is stripped from the hit's host, never from the
  // site's list, and nothing is lowercased.
  const host = plan.site.domain.replace(/^www\./, "");
  if (!host) {
    return [{ code: "PL-11", severity: "block", event: "site", message: "site.domain is empty; pixel-service rejects hits without a domain." }];
  }
  if (domains.length && (domains.includes(host) || domains.some((d) => host.endsWith(`.${d}`)))) return [];
  const www = domains.filter((d) => d.startsWith("www."));
  if (www.some((d) => d.slice(4) === host || host.endsWith(`.${d.slice(4)}`))) {
    return [{
      code: "PL-11",
      severity: "block",
      event: "site",
      message: `The site lists ${www.join(", ")} with the www. prefix. pixel-service strips www. from every hit's host before matching, so '${host}' never matches and all hits are rejected (invalid_domain; the tracker script itself is refused with 403).`,
      fix: `Change the site's domain to '${www[0].slice(4)}' in the dashboard; it also covers www. and every subdomain.`,
    }];
  }
  return [{
    code: "PL-11",
    severity: "block",
    event: "site",
    message: `'${plan.site.domain}' is not among the site's domains (${domains.join(", ") || "none"}). pixel-service rejects every hit from it as invalid_domain, with a 204 and no error.`,
    fix: "Add the domain to the site in the dashboard, or plan the install for a listed domain.",
  }];
};

export const PL12_size: Rule = (plan) =>
  tracked(plan).flatMap((e) => {
    const bytes = estimateBodyBytes(plan, e);
    if (bytes <= EVENT_BODY_WARN_BYTES) return [];
    const fit = maxItemsUnder(plan, e, EVENT_BODY_WARN_BYTES);
    const over = bytes > EVENT_BODY_LIMIT_BYTES;
    return [{
      code: "PL-12",
      severity: over ? ("block" as const) : ("warn" as const),
      event: e.name,
      message: `'${e.name}' at its largest is about ${bytes} bytes encoded; pixel-service reads ${EVENT_BODY_LIMIT_BYTES} and rejects a truncated body as invalid_json without an error.`,
      fix: fit !== null ? `Cap the list at ${fit} items, or send fewer properties per item.` : "Send fewer or shorter properties.",
    }];
  });

export const PL13_existingLoader: Rule = (plan, ctx) => {
  if (!ctx.repo) return [];
  const tags = ctx.repo.loaders.filter((l) => !/sealmetrics\.q\b/.test(l.text));
  const elsewhere = tags.filter((l) => !plan.loader.file || l.file !== plan.loader.file);
  if (!tags.length || (!elsewhere.length && tags.length === 1)) return [];
  return [{
    code: "PL-13",
    severity: "warn",
    event: "loader",
    message: `The repo already loads a Sealmetrics tracker (${tags.slice(0, 3).map((l) => `${l.file}:${l.line}`).join(", ")}). Two installations send every pageview twice.`,
    fix: "Reuse the existing loader, or remove it in the same change.",
  }];
};

export const PL14_unplannedCalls: Rule = (plan, ctx) => {
  if (!ctx.repo) return [];
  const planned = new Set(tracked(plan).map((e) => `${e.kind}:${e.name}`));
  const unplanned = ctx.repo.calls.filter((c) => !planned.has(`${c.kind}:${c.name}`));
  const byName = new Map<string, typeof unplanned>();
  for (const c of unplanned) byName.set(`${c.kind}:${c.name}`, [...(byName.get(`${c.kind}:${c.name}`) ?? []), c]);
  return [...byName.entries()].map(([k, calls]) => ({
    code: "PL-14",
    severity: "warn" as const,
    event: k.split(":")[1],
    message: `The repo already calls sealmetrics.${k.replace(":", "('")}') at ${calls.slice(0, 3).map((c) => `${c.file}:${c.line}`).join(", ")}, and the plan does not include it.`,
    fix: "Add it to the plan so the approval covers what the site really sends, or remove the call.",
  }));
};

export const PL15_funnel: Rule = (plan) => {
  const needed = plan.vertical ? FUNNELS[plan.vertical] : [];
  const names = new Set(tracked(plan).map((e) => e.name));
  const missing = needed.filter((n) => !names.has(n));
  if (!missing.length) return [];
  return [{
    code: "PL-15",
    severity: "info",
    message: `The ${plan.vertical} funnel usually also measures: ${missing.join(", ")}.`,
  }];
};

export const PL16_snippet: Rule = (plan, ctx) => {
  const l = plan.loader;
  const findings: PlanFinding[] = [];
  const expected = (ctx.options.trackerOrigin ?? DEFAULT_TRACKER_ORIGIN).replace(/\/$/, "");
  if (!l.origin) {
    return [{ code: "PL-16", severity: "block", event: "loader", message: `snippet_url '${l.snippet_url}' is not a URL.`, fix: "Use the script_tag src from get_tracking_code verbatim." }];
  }
  if (l.account_id_in_url !== plan.account_id) {
    findings.push({
      code: "PL-16",
      severity: "block",
      event: "loader",
      message: `The snippet loads account '${l.account_id_in_url ?? "(none)"}', but the plan is for '${plan.account_id}'. Hits would go to another site or be rejected.`,
      fix: "Use the script_tag src from get_tracking_code for this site.",
    });
  }
  // tracker.go answers 400 to a group outside isValidGroup: the tracker never loads.
  if (!/^[a-zA-Z0-9_-]{0,64}$/.test(l.group)) {
    findings.push({
      code: "PL-16",
      severity: "block",
      event: "loader",
      message: `group '${l.group}' is not valid for /t.js (letters, digits, _ and -, up to 64): pixel-service answers 400 and the tracker never loads.`,
      fix: "Use a group made of letters, digits, _ or -.",
    });
  }
  for (const e of plan.events.filter((ev) => ev.kind === "pageview" && ev.group !== undefined)) {
    if (!/^[a-zA-Z0-9_-]{0,64}$/.test(e.group!)) {
      findings.push({ code: "PL-16", severity: "warn", event: "pageview", message: `Manual pageview group '${e.group}' uses characters the tracker URL does not accept; keep groups to letters, digits, _ and -.` });
    }
  }
  if (l.origin !== expected) {
    findings.push({
      code: "PL-16",
      severity: "warn",
      event: "loader",
      message: `The tracker is loaded from ${l.origin}, not ${expected}. Correct only for a first-party proxy that serves the same tracker.`,
    });
  }
  return findings;
};

export const PL17_keyNaming: Rule = (plan) =>
  plan.events.flatMap((e) =>
    Object.keys(e.properties)
      .filter((k) => !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(k) || k.length > 40)
      .map((k) => ({
        code: "PL-17",
        severity: "info" as const,
        event: e.name,
        message: `Property '${k}' is not snake_case under 40 characters; the reports list keys as sent.`,
      })),
  );

/** Explicit loader flags that contradict the snippet URL (reported under PL-16). */
export function loaderFlagFindings(raw: { auto_pageview?: boolean; spa_pageview?: boolean }, plan: NormalizedPlan): PlanFinding[] {
  const out: PlanFinding[] = [];
  for (const [flag, param] of [["auto_pageview", "auto"], ["spa_pageview", "spa"]] as const) {
    if (raw[flag] !== undefined && raw[flag] !== plan.loader[flag]) {
      out.push({
        code: "PL-16",
        severity: "block",
        event: "loader",
        message: `loader.${flag} is ${raw[flag]}, but the snippet URL makes it ${plan.loader[flag]}. pixel-service only reads the URL: ${param}=0 disables it, anything else keeps it on.`,
        fix: `${raw[flag] ? `Remove &${param}=0 from the snippet URL` : `Add &${param}=0 to the snippet URL`}, or drop loader.${flag}.`,
      });
    }
  }
  return out;
}

export const RULES: Rule[] = [
  PL01_taxonomy, PL02_piiKeys, PL03_piiExamples, PL04_revenue, PL05_currency, PL06_productIdentifier,
  PL07_duplicates, PL08_doublePageview, PL09_missingPageviews, PL10_stub, PL11_domain, PL12_size,
  PL13_existingLoader, PL14_unplannedCalls, PL15_funnel, PL16_snippet, PL17_keyNaming,
];

export type { NormalizedEvent };
