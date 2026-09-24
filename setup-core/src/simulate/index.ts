/**
 * `simulateInstall` (PRD-058 C3/C4). Runs each planned event through the real
 * tracker in the sandbox, reads the captured body back through the pixel-service
 * mirror, and checks it against the approved plan. Nothing leaves the process.
 *
 * The result is "simulated", never "verified": production state (token, blocklists,
 * bot detection) is not reproduced, and only `verify_event_instrumented` proves an
 * event reached Sealmetrics.
 */
import { createHash } from "node:crypto";
import { TRACKER_SHA256 } from "../generated/tracker.js";
import { planInstall } from "../plan/index.js";
import { canonicalJson, computePlanId, normalizePlan } from "../plan/normalize.js";
import { fileHasCall } from "../plan/repo.js";
import { exampleHints, exampleProperties } from "../plan/size.js";
import type { InstallPlanInput, NormalizedEvent, NormalizedPlan, PlanFinding } from "../plan/types.js";
import { NOT_MIRRORED, mirrorEvent, type MirrorResult, type StoredEvent } from "./mirror.js";
import { checkPayload, type CheckOutcome, type SimCheck } from "./checks.js";

export type { CheckOutcome, SimCheck } from "./checks.js";
import { TRACKER_STUB, createPage, type SimPage, type TrackerCall, type TrackerFlags } from "./sandbox.js";

export type ScenarioName = "load" | "spa_navigation" | "stub_queue" | "iframe";

export interface SimulationCase {
  /** Planned event name; `pageview` for a manual pageview. */
  event: string;
  kind?: "conv" | "micro" | "pageview";
  /** Plain JavaScript, exactly the call as written in the site (types stripped). */
  code: string;
  /** Synthetic fixtures for the variables `code` reads. */
  vars?: Record<string, unknown>;
  context?: { url?: string; referrer?: string; before_tracker_load?: boolean };
  source?: { file: string; line?: number };
}

export interface SimulateInstallInput {
  plan: InstallPlanInput;
  plan_id: string;
  cases?: SimulationCase[];
  scenarios?: ScenarioName[];
}

export interface SimulateOptions {
  /** Site domains for the domain rule; `null` / omitted → not simulated. */
  siteDomains?: string[] | null;
}

export interface SimHit {
  body_bytes: number;
  transport: "beacon" | "fetch";
  payload?: Record<string, unknown>;
  stored_as?: StoredEvent;
  rejection: string | null;
  detail?: string;
}

export interface CaseResult {
  event: string;
  kind: string;
  synthetic: boolean;
  verdict: "pass" | "fail";
  hits: SimHit[];
  checks: SimCheck[];
}

export interface ScenarioResult {
  name: ScenarioName;
  verdict: "pass" | "fail" | "warn" | "info";
  pageviews?: number;
  checks: SimCheck[];
}

export interface SimulationResult {
  status: "ok" | "stale_plan" | "blocked_plan";
  simulation_id: string | null;
  plan_id: string;
  level: "call";
  tracker: { sha256: string; source: "pixel-service tracker.go" };
  verdict: "pass" | "fail";
  cases: CaseResult[];
  scenarios: ScenarioResult[];
  findings?: PlanFinding[];
  not_simulated: string[];
  wording: string;
}

const WORDING = "Simulated, not verified: nothing has reached Sealmetrics. Only verify_event_instrumented, after the user deploys, confirms an event.";

function flagsOf(plan: NormalizedPlan): TrackerFlags {
  return {
    accountId: plan.account_id,
    group: plan.loader.group,
    auto: plan.loader.auto_pageview,
    spa: plan.loader.spa_pageview,
  };
}

function syntheticCode(e: NormalizedEvent, hints: Record<string, unknown> = {}): string {
  if (e.kind === "pageview") return e.group ? `sealmetrics(${JSON.stringify({ group: e.group })});` : "sealmetrics();";
  const props = exampleProperties(e, undefined, hints);
  const x = Object.keys(props).length ? `, ${JSON.stringify(props)}` : "";
  if (e.kind === "micro") return `sealmetrics.micro(${JSON.stringify(e.name)}${x});`;
  const value = e.value?.example !== undefined ? JSON.stringify(e.value.example) : "0";
  return `sealmetrics.conv(${JSON.stringify(e.name)}, ${value}${x});`;
}

const isPageview = (m: MirrorResult) => !(typeof m.payload?.e === "string" && m.payload.e !== "");

function hitView(m: MirrorResult, transport: SimHit["transport"]): SimHit {
  const hit: SimHit = { body_bytes: m.body_bytes, transport, rejection: m.rejection };
  if (m.payload) hit.payload = m.payload;
  if (m.stored_as) hit.stored_as = m.stored_as;
  if (m.detail) hit.detail = m.detail;
  return hit;
}

function checkCase(
  plan: NormalizedPlan,
  planned: NormalizedEvent,
  c: SimulationCase,
  page: SimPage,
  hits: { mirror: MirrorResult; transport: SimHit["transport"] }[],
  calls: TrackerCall[],
  repoPath: string | undefined,
): SimCheck[] {
  const checks: SimCheck[] = [];
  const caseErrors = page.errors.filter((e) => e.phase !== "load");

  // SM-02 — the call threw.
  for (const err of caseErrors) {
    const notDefined = /sealmetrics is not defined/.test(err.message);
    checks.push({
      code: "SM-02",
      result: "fail",
      message: `The code threw: ${err.message}${err.line ? ` (line ${err.line})` : ""}.${notDefined ? " The tracker was not loaded yet, so the event is lost." : ""}`,
      fix: notDefined ? "Inline the queue stub in <head> before the tracker, or call only after it loads." : undefined,
    });
  }

  const relevant = hits;

  // SM-01 — exactly one hit.
  if (relevant.length === 1) {
    checks.push({ code: "SM-01", result: "pass", message: "Exactly one hit." });
  } else if (relevant.length === 0) {
    const silent = !caseErrors.length && /\?\./.test(c.code);
    checks.push({
      code: "SM-01",
      result: "fail",
      message: silent
        ? "No hit, and no error: optional chaining (sealmetrics?.…) skips the call when the tracker has not loaded, and the event is lost silently."
        : "The code sent no hit.",
      fix: silent ? "Use the queue stub instead of optional chaining." : undefined,
    });
  } else {
    checks.push({ code: "SM-01", result: "fail", message: `The code sent ${relevant.length} hits for one action; every one is stored.` });
  }

  const first = relevant[0]?.mirror;
  if (!first) return checks;
  const call = calls.find((k) => k.fn === "conv" && k.args[0]?.value === planned.name);
  checks.push(...checkPayload(planned, first, call?.args[1]));

  // SM-10 — the simulated call exists in the file.
  if (repoPath && c.source?.file && planned.kind !== "pageview" && !fileHasCall(repoPath, c.source.file, planned.name, c.source.line)) {
    checks.push({
      code: "SM-10",
      result: "warn",
      message: `No sealmetrics.${planned.kind}('${planned.name}') found in ${c.source.file}${c.source.line ? ` near line ${c.source.line}` : ""}: what was simulated may not be what is on disk.`,
    });
  }
  return checks;
}

function runCase(
  plan: NormalizedPlan,
  planned: NormalizedEvent,
  c: SimulationCase,
  synthetic: boolean,
  domains: string[] | null,
  repoPath: string | undefined,
): CaseResult {
  const page = createPage({ url: c.context?.url ?? `https://${plan.site.domain}/`, referrer: c.context?.referrer });
  let calls: TrackerCall[];
  const filename = c.source?.file ?? "case.js";

  if (c.context?.before_tracker_load) {
    if (plan.loader.stub) page.run(TRACKER_STUB, "stub.js");
    page.setPhase("case");
    page.defineVars(c.vars ?? {});
    page.run(c.code, filename);
    calls = page.queuedCalls();
    page.setPhase("drain");
    page.loadTracker(flagsOf(plan));
  } else {
    page.loadTracker(flagsOf(plan));
    page.watchCalls();
    page.setPhase("case");
    page.defineVars(c.vars ?? {});
    page.run(c.code, filename);
    calls = page.calls;
  }

  const accountIds = [plan.account_id];
  // Only the hits of the case's own kind: the tracker's automatic pageviews are not the case.
  const produced = page.hits
    .filter((h) => h.phase === "case" || h.phase === "drain")
    .map((h) => ({ mirror: mirrorEvent({ body: h.body, accountIds, domains }), transport: h.transport }))
    // An unparseable body (invalid_json) has no event name; it still belongs to a conv/micro case.
    .filter((h) => (planned.kind === "pageview" ? h.mirror.payload !== undefined && isPageview(h.mirror) : h.mirror.payload === undefined || !isPageview(h.mirror)));
  // A queued pageview drains before the tracker's own auto-pageview; that last one is not the case's.
  if (c.context?.before_tracker_load && planned.kind === "pageview" && plan.loader.auto_pageview && produced.length > 0) {
    produced.pop();
  }

  const checks = checkCase(plan, planned, c, page, produced, calls, repoPath);
  return {
    event: planned.name,
    kind: planned.kind,
    synthetic,
    verdict: checks.some((k) => k.result === "fail") ? "fail" : "pass",
    hits: produced.map((h) => hitView(h.mirror, h.transport)),
    checks,
  };
}

/** Event name in a captured body; "" for a pageview, null when the body does not parse. */
function eventOf(body: string): string | null {
  try {
    const d = JSON.parse(new URLSearchParams(body).get("d") ?? "") as { e?: unknown };
    return typeof d.e === "string" ? d.e : "";
  } catch {
    return null;
  }
}

function countPageviews(page: SimPage, phase: string): number {
  return page.hits.filter((h) => h.phase === phase && eventOf(h.body) === "").length;
}

function manualPageviews(plan: NormalizedPlan, trigger: "page" | "route"): NormalizedEvent[] {
  return plan.events.filter((e) => e.kind === "pageview" && (trigger === "route" ? e.trigger?.type === "route" : e.trigger?.type !== "route"));
}

/** Exported for tests: a scenario on a plan that plan_install would block. */
export function runScenario(plan: NormalizedPlan, name: ScenarioName): ScenarioResult {
  const flags = flagsOf(plan);
  const base = `https://${plan.site.domain}/`;

  if (name === "load") {
    const page = createPage({ url: base });
    page.loadTracker(flags);
    for (const e of manualPageviews(plan, "page")) page.run(syntheticCode(e), "pageview.js");
    const n = countPageviews(page, "load");
    const verdict = n === 1 ? "pass" : "fail";
    return {
      name,
      verdict,
      pageviews: n,
      checks: [{
        code: "SC-01",
        result: verdict,
        message: n === 1 ? "One pageview per page load." : n === 0 ? "No pageview on page load: auto=0 and no manual pageview." : `${n} pageviews per page load: every page counts ${n} times.`,
      }],
    };
  }

  if (name === "spa_navigation") {
    const page = createPage({ url: base });
    page.loadTracker(flags);
    const route = manualPageviews(plan, "route");
    page.setPhase("navigate");
    const steps = [() => page.pushState("/sim-nav-1"), () => page.pushState("/sim-nav-2"), () => page.back("/sim-nav-1")];
    for (const step of steps) {
      step();
      for (const e of route) page.run(syntheticCode(e), "route-pageview.js");
    }
    const n = countPageviews(page, "navigate");
    if (n === steps.length) {
      return { name, verdict: "pass", pageviews: n, checks: [{ code: "SC-02", result: "pass", message: "One pageview per client-side navigation." }] };
    }
    if (n === 0) {
      return {
        name, verdict: "warn", pageviews: n,
        checks: [{ code: "SC-02", result: "warn", message: "Client-side navigations record no pageview (spa=0, no route pageview). Correct only if the site is not a single-page app." }],
      };
    }
    return {
      name, verdict: "fail", pageviews: n,
      checks: [{
        code: "SC-02",
        result: "fail",
        message: `${n} pageviews for ${steps.length} navigations: the tracker's automatic SPA pageview and a manual route pageview both fire (PRD-034).`,
        fix: "Remove the manual route pageview, or load the tracker with &spa=0.",
      }],
    };
  }

  if (name === "stub_queue") {
    const page = createPage({ url: base });
    const queued = plan.events.filter((e) => e.kind !== "pageview").slice(0, 3);
    if (plan.loader.stub) page.run(TRACKER_STUB, "stub.js");
    page.setPhase("queue");
    for (const e of queued) page.run(syntheticCode(e, exampleHints(plan)), "early-call.js");
    page.setPhase("drain");
    page.loadTracker(flags);
    if (!plan.loader.stub) {
      const threw = page.errors.some((e) => /sealmetrics is not defined/.test(e.message));
      return {
        name,
        verdict: threw ? "fail" : "info",
        checks: [{
          code: "SC-03",
          result: threw ? "fail" : "info",
          message: threw ? "Without the stub, a call made before the tracker loads throws 'sealmetrics is not defined' and the event is lost." : "No early calls to check.",
          fix: threw ? "Inline the queue stub in <head> before the tracker (stub: true)." : undefined,
        }],
      };
    }
    const order = page.hits
      .filter((h) => h.phase === "drain")
      .map((h) => eventOf(h.body) || (eventOf(h.body) === "" ? "pageview" : "?"));
    const expected = [...queued.map((e) => e.name), ...(plan.loader.auto_pageview ? ["pageview"] : [])];
    const ok = canonicalJson(order) === canonicalJson(expected);
    return {
      name,
      verdict: ok ? "pass" : "fail",
      checks: [{
        code: "SC-03",
        result: ok ? "pass" : "fail",
        message: ok ? `Queued calls drained in order before the auto-pageview: ${order.join(" → ")}.` : `Drain order ${order.join(" → ")}, expected ${expected.join(" → ")}.`,
      }],
    };
  }

  if (name !== "iframe") {
    return { name, verdict: "info", checks: [{ code: "SC-00", result: "info", message: `Unknown scenario '${String(name)}'; known: load, spa_navigation, stub_queue, iframe.` }] };
  }
  const page = createPage({ url: base, iframe: true });
  page.loadTracker(flags);
  const n = countPageviews(page, "load");
  return {
    name: "iframe",
    verdict: "info",
    pageviews: n,
    checks: [{ code: "SC-04", result: "info", message: `Inside an iframe the tracker sends ${n} automatic pageviews (it only auto-tracks in the top window, e.g. Shopify's Web Pixels sandbox).` }],
  };
}

export function simulateInstall(input: SimulateInstallInput, options: SimulateOptions = {}): SimulationResult {
  const plan = normalizePlan(input.plan);
  const currentId = computePlanId(plan);
  const domains = Array.isArray(options.siteDomains) ? options.siteDomains : null;
  const notSimulated = [...(domains ? [] : ["invalid_domain"]), ...NOT_MIRRORED];
  const empty = {
    level: "call" as const,
    tracker: { sha256: TRACKER_SHA256, source: "pixel-service tracker.go" as const },
    verdict: "fail" as const,
    cases: [],
    scenarios: [],
    not_simulated: notSimulated,
    wording: WORDING,
  };

  if (currentId !== input.plan_id) {
    return {
      ...empty,
      status: "stale_plan",
      simulation_id: null,
      plan_id: currentId,
      findings: [{
        code: "PL-00",
        severity: "block",
        message: `This plan now hashes to ${currentId}, not the approved ${input.plan_id}: it changed after approval. Run plan_install on the new plan and get the user's approval again.`,
      }],
    };
  }

  // A blocked plan is never simulated. The repository rules are skipped: they only warn.
  const planCheck = planInstall({ ...input.plan, repo_path: undefined }, { siteDomains: domains });
  const blocking = planCheck.findings.filter((f) => f.severity === "block");
  if (blocking.length) {
    return { ...empty, status: "blocked_plan", simulation_id: null, plan_id: currentId, findings: blocking };
  }

  const cases: CaseResult[] = [];
  const provided = input.cases ?? [];
  for (const c of provided) {
    const name = c.kind === "pageview" ? "pageview" : String(c.event).trim().toLowerCase();
    const planned = plan.events.find((e) => e.name === name && (!c.kind || e.kind === c.kind));
    if (!planned) {
      cases.push({
        event: c.event,
        kind: c.kind ?? "unknown",
        synthetic: false,
        verdict: "fail",
        hits: [],
        checks: [{ code: "SM-00", result: "fail", message: `'${c.event}' is not in the approved plan (not_in_plan). Add it with plan_install and get approval before writing it.` }],
      });
      continue;
    }
    cases.push(runCase(plan, planned, c, false, domains, input.plan.repo_path));
  }
  for (const e of plan.events) {
    if (cases.some((r) => r.event === e.name && r.kind === e.kind)) continue;
    cases.push(runCase(plan, e, { event: e.name, kind: e.kind, code: syntheticCode(e, exampleHints(plan)) }, true, domains, undefined));
  }

  // SM-09 — the product identifier carries one value across events.
  const pi = plan.product_identifier;
  if (pi) {
    const values = new Map<string, string>();
    for (const target of pi.applies_to) {
      const [eventName, listKey] = target.split(".");
      const r = cases.find((k) => k.event === eventName);
      const x = r?.hits[0]?.payload?.x as Record<string, unknown> | undefined;
      if (!x) continue;
      const raw = listKey ? (Array.isArray(x[listKey]) ? (x[listKey] as Record<string, unknown>[])[0]?.[pi.key] : undefined) : x[pi.key];
      if (raw !== undefined) values.set(target, String(raw));
    }
    if (new Set(values.values()).size > 1) {
      const allSynthetic = pi.applies_to.every((t) => cases.find((k) => k.event === t.split(".")[0])?.synthetic !== false);
      const target = cases.find((k) => k.event === pi.applies_to[0].split(".")[0]);
      target?.checks.push({
        code: "SM-09",
        result: allSynthetic ? "fail" : "warn",
        message: `'${pi.key}' differs across events: ${[...values.entries()].map(([t, v]) => `${t}=${v}`).join(", ")}. ${allSynthetic ? "The plan's own examples disagree." : "If the cases used the same product, per-SKU joins break."}`,
      });
      if (target && allSynthetic) target.verdict = "fail";
    }
  }

  const wanted: ScenarioName[] = input.scenarios ?? [
    "load",
    "spa_navigation",
    ...(plan.loader.stub || plan.events.some((e) => e.trigger?.type === "datalayer" || e.trigger?.type === "code") ? (["stub_queue"] as const) : []),
  ];
  const scenarios = wanted.map((s) => runScenario(plan, s));

  const verdict = cases.some((c) => c.verdict === "fail") || scenarios.some((s) => s.verdict === "fail") ? "fail" : "pass";
  const simulation_id =
    "sim_" +
    createHash("sha256")
      .update(currentId + canonicalJson({ cases: cases.map((c) => [c.event, c.hits.map((h) => h.payload ?? null)]), scenarios: scenarios.map((s) => [s.name, s.pageviews ?? null]) }))
      .digest("hex")
      .slice(0, 12);

  return {
    ...empty,
    status: "ok",
    simulation_id,
    plan_id: currentId,
    verdict,
    cases,
    scenarios,
    wording: WORDING,
  };
}

export { mirrorEvent, MAX_EVENT_BODY_BYTES, NOT_MIRRORED, flexStringMap, goFormatG, goJsonMarshal, goExtractDomain, goIsDomainAllowed } from "./mirror.js";
export type { MirrorInput, MirrorResult, MirrorRejection, StoredEvent } from "./mirror.js";
export { TRACKER_STUB, SIM_ENDPOINT, SIM_NOW, createPage, buildTrackerScript, sanitizeJSString } from "./sandbox.js";
export { simulatePage, PAGE_LIMITS } from "./page/index.js";
export type { SimulatePageInput, PageSimulationResult, PageFlow, PageStep, FlowResult, PageHit } from "./page/index.js";
export { resolveBrowser } from "./page/browser.js";
