/**
 * Page-level simulation, L2 (PRD-058 F3). Where the call-level sandbox runs a call the
 * agent re-states, this drives a real browser through the site on the developer's
 * dev server: the snippet as placed, the framework's load order, the router, the CSP,
 * console errors, a duplicated tag. Every request to a Sealmetrics origin is answered
 * locally — hits to `/event` are captured and get a 204, the tracker script is served
 * from the vendored copy, anything else is aborted — so nothing reaches pixel-service.
 * Captured hits go through the same mirror and payload checks as the call level.
 *
 * Also the load-order harness PRD-050 RF-006 asks for: `tracker_delay_ms` serves the
 * tracker late, and a flow can require exactly one purchase and no console error.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRACKER_SHA256 } from "../../generated/tracker.js";
import { planInstall } from "../../plan/index.js";
import { canonicalJson, computePlanId, normalizePlan, parseSnippetUrl } from "../../plan/normalize.js";
import type { InstallPlanInput, NormalizedPlan, PlanFinding } from "../../plan/types.js";
import { checkPayload, type SimCheck } from "../checks.js";
import { NOT_MIRRORED, mirrorEvent, type MirrorResult, type StoredEvent } from "../mirror.js";
import { SIM_ENDPOINT, buildTrackerScript } from "../sandbox.js";
import { resolveBrowser } from "./browser.js";

export const PAGE_LIMITS = {
  stepsPerFlow: 20,
  flowMs: 30_000,
  totalMs: 120_000,
  hitWaitMs: 5_000,
  settleMs: 1_200,
  maxTrackerDelayMs: 10_000,
} as const;

export interface PageStep {
  /** Path or URL, resolved against base_url. */
  goto?: string;
  click?: string;
  fill?: { selector: string; value: string };
  /** A form selector: submitted with requestSubmit(), as a user would. */
  submit?: string;
  wait_ms?: number;
  /** Exactly one hit from this step. `e` omitted = a pageview. */
  expect_hit?: { e?: string; m?: boolean };
  /** Pageviews captured since the flow started, counted after a short settle. */
  expect_pageviews?: number;
}

export interface PageFlow {
  /** The planned event this flow exercises, or "pageview". */
  event: string;
  steps: PageStep[];
}

export interface SimulatePageInput {
  plan: InstallPlanInput;
  plan_id: string;
  base_url: string;
  /** Required to drive anything but a loopback host; the skill passes it only with the user's say-so. */
  allow_remote_url?: boolean;
  /** `vendored` (default) serves the tracker production serves; `cdn` lets the real one load. */
  tracker_source?: "vendored" | "cdn";
  /** Serve the tracker this late, to exercise load order (PRD-050 RF-006). Capped at 10 s. */
  tracker_delay_ms?: number;
  flows: PageFlow[];
  /** Where to write a screenshot of a failed flow. Omitted = no screenshot. */
  screenshot_dir?: string;
}

export interface PageHit {
  step: number;
  body_bytes: number;
  payload?: Record<string, unknown>;
  stored_as?: StoredEvent;
  rejection: string | null;
}

export interface FlowResult {
  event: string;
  verdict: "pass" | "fail";
  steps_run: number;
  hits: PageHit[];
  checks: SimCheck[];
  console_errors: string[];
  screenshot?: string;
}

export interface PageSimulationResult {
  status: "ok" | "stale_plan" | "blocked_plan" | "unavailable" | "invalid_input";
  level: "page";
  simulation_id: string | null;
  plan_id: string;
  verdict: "pass" | "fail";
  browser?: { source: string; version: string };
  tracker: { source: "vendored" | "cdn"; sha256: string; delay_ms: number };
  flows: FlowResult[];
  findings?: PlanFinding[];
  install?: string[];
  message?: string;
  not_simulated: string[];
  wording: string;
}

const WORDING = "Simulated in a local browser, not verified: every Sealmetrics request was answered locally and nothing reached Sealmetrics. Only verify_event_instrumented, after the user deploys, confirms an event.";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const isLoopback = (host: string) => LOOPBACK.has(host) || host.endsWith(".localhost");

/** Minimal shapes of the playwright objects used here; the package stays optional. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyPage = any;
type AnyContext = any;
type AnyRoute = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Captured {
  step: number;
  kind: "event" | "agent-signals";
  body: string;
  contentType: string;
  mirror: MirrorResult;
}

function emptyResult(planId: string, input: SimulatePageInput, over: Partial<PageSimulationResult>): PageSimulationResult {
  return {
    status: "ok",
    level: "page",
    simulation_id: null,
    plan_id: planId,
    verdict: "fail",
    tracker: { source: input.tracker_source ?? "vendored", sha256: TRACKER_SHA256, delay_ms: clampDelay(input.tracker_delay_ms) },
    flows: [],
    not_simulated: ["invalid_domain (hits come from the dev server's host)", ...NOT_MIRRORED],
    wording: WORDING,
    ...over,
  };
}

const clampDelay = (ms: unknown) =>
  typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, Math.min(ms, PAGE_LIMITS.maxTrackerDelayMs)) : 0;

function validateFlows(flows: unknown): string | null {
  if (!Array.isArray(flows) || flows.length === 0) return "flows is empty: give one flow per planned event, with the steps that trigger it.";
  for (const [i, f] of flows.entries()) {
    if (!f || typeof f !== "object") return `flows[${i}] is not an object.`;
    const flow = f as Partial<PageFlow>;
    if (typeof flow.event !== "string" || !flow.event.trim()) return `flows[${i}].event must be the planned event name, or "pageview".`;
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) return `flows[${i}] ('${flow.event}') has no steps.`;
    if (flow.steps.length > PAGE_LIMITS.stepsPerFlow) return `Flow '${flow.event}' has more than ${PAGE_LIMITS.stepsPerFlow} steps.`;
    for (const [j, s] of flow.steps.entries()) {
      if (!s || typeof s !== "object") return `flows[${i}].steps[${j}] is not an object.`;
    }
  }
  return null;
}

export async function simulatePage(input: SimulatePageInput): Promise<PageSimulationResult> {
  const startedAt = Date.now();
  const plan = normalizePlan(input.plan);
  const planId = computePlanId(plan);

  if (planId !== input.plan_id) {
    return emptyResult(planId, input, {
      status: "stale_plan",
      findings: [{ code: "PL-00", severity: "block", message: `This plan now hashes to ${planId}, not the approved ${input.plan_id}: it changed after approval. Run plan_install on the new plan and get the user's approval again.` }],
    });
  }
  const blocking = planInstall({ ...input.plan, repo_path: undefined }, {}).findings.filter((f) => f.severity === "block" && f.code !== "PL-11");
  if (blocking.length) return emptyResult(planId, input, { status: "blocked_plan", findings: blocking });

  let base: URL;
  try {
    base = new URL(input.base_url);
  } catch {
    return emptyResult(planId, input, { status: "invalid_input", message: `base_url '${input.base_url}' is not a URL.` });
  }
  if (!isLoopback(base.hostname) && input.allow_remote_url !== true) {
    return emptyResult(planId, input, {
      status: "invalid_input",
      message: `base_url ${base.origin} is not a local dev server. Driving a remote site needs allow_remote_url: true, which is the user's decision.`,
    });
  }
  const invalid = validateFlows(input.flows);
  if (invalid) return emptyResult(planId, input, { status: "invalid_input", message: invalid });

  const resolved = await resolveBrowser();
  if (!resolved.ok) return emptyResult(planId, input, { status: "unavailable", message: resolved.message, install: resolved.install });

  const results: FlowResult[] = [];
  try {
    for (const flow of input.flows) {
      const remaining = PAGE_LIMITS.totalMs - (Date.now() - startedAt);
      if (remaining < 2_000) {
        results.push({ event: flow.event, verdict: "fail", steps_run: 0, hits: [], console_errors: [], checks: [{ code: "SP-00", result: "fail", message: `Not run: the ${PAGE_LIMITS.totalMs / 1000} s budget for the whole simulation was spent.` }] });
        continue;
      }
      try {
        results.push(await runFlow(resolved.browser as unknown as { newContext(o?: unknown): Promise<AnyContext> }, plan, input, base, flow, Math.min(PAGE_LIMITS.flowMs, remaining)));
      } catch (e) {
        results.push({ event: flow.event, verdict: "fail", steps_run: 0, hits: [], console_errors: [], checks: [{ code: "SP-00", result: "fail", message: `The flow could not run: ${String((e as Error)?.message ?? e).split("\n")[0]}` }] });
      }
    }
  } finally {
    await resolved.browser.close().catch(() => undefined);
  }

  const verdict = results.some((r) => r.verdict === "fail") ? "fail" : "pass";
  const simulation_id =
    "simp_" +
    createHash("sha256")
      .update(planId + canonicalJson(results.map((r) => [r.event, r.hits.map((h) => [h.step, typeof h.payload?.e === "string" ? h.payload.e : "pageview"])])))
      .digest("hex")
      .slice(0, 12);

  return emptyResult(planId, input, {
    status: "ok",
    simulation_id,
    verdict,
    browser: { source: resolved.source, version: resolved.version },
    flows: results,
  });
}

/** Origins whose every request must be answered locally: the simulated endpoint, the snippet's host, and production. */
function trackerOrigins(plan: NormalizedPlan): Set<string> {
  const origins = new Set([new URL(SIM_ENDPOINT).origin, "https://t.sealmetrics.com"]);
  if (plan.loader.origin) origins.add(plan.loader.origin);
  return origins;
}

const isPageviewHit = (c: Captured) => c.kind === "event" && c.mirror.payload !== undefined && !(typeof c.mirror.payload.e === "string" && c.mirror.payload.e !== "");

async function runFlow(
  browser: { newContext(o?: unknown): Promise<AnyContext> },
  plan: NormalizedPlan,
  input: SimulatePageInput,
  base: URL,
  flow: PageFlow,
  budgetMs: number,
): Promise<FlowResult> {
  const checks: SimCheck[] = [];
  const consoleErrors: string[] = [];
  const captured: Captured[] = [];
  const trackerResponses: { step: number; status: number }[] = [];
  const cspViolations: string[] = [];
  const origins = trackerOrigins(plan);
  const snippetPath = parseSnippetUrl(plan.loader.snippet_url).pathname ?? "/t.js";
  const delay = clampDelay(input.tracker_delay_ms);
  const deadline = Date.now() + budgetMs;
  const remaining = () => Math.max(1_000, deadline - Date.now());
  let step = 0;
  let stepsRun = 0;
  let screenshot: string | undefined;

  const context: AnyContext = await browser.newContext({ serviceWorkers: "block", ignoreHTTPSErrors: true });
  let page: AnyPage;
  try {
    // CSP violations are DOM events: report each one to Node as it happens, from every
    // document and frame, so a navigation does not lose the ones before it.
    await context.exposeBinding("__smReportCsp", (_source: unknown, v: string) => {
      cspViolations.push(v);
    });
    await context.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        if (e.disposition !== "enforce") return;
        (window as unknown as { __smReportCsp?: (v: string) => void }).__smReportCsp?.(`${e.violatedDirective} blocked ${e.blockedURI}`);
      });
    });

    await context.route("**/*", async (route: AnyRoute) => {
      const request = route.request();
      const at = step; // read before any await: the hit belongs to the step that sent it
      let url: URL;
      try {
        url = new URL(request.url());
      } catch {
        await route.continue().catch(() => undefined);
        return;
      }
      if (origins.has(url.origin)) {
        if (/\/(event|agent-signals)$/.test(url.pathname)) {
          const body = request.postData() ?? "";
          const contentType = request.headers()["content-type"] ?? "";
          const kind = url.pathname.endsWith("/event") ? "event" : "agent-signals";
          captured.push({ step: at, kind, body, contentType, mirror: mirrorEvent({ body, contentType, accountIds: [plan.account_id], domains: null }) });
          await route.fulfill({ status: 204, body: "" }).catch(() => undefined);
          return;
        }
        if (url.pathname === snippetPath) {
          if (delay) await new Promise((r) => setTimeout(r, delay));
          if ((input.tracker_source ?? "vendored") === "vendored") {
            const parsed = parseSnippetUrl(url.href);
            const script = buildTrackerScript({ accountId: parsed.id ?? "", group: parsed.group, auto: parsed.auto, spa: parsed.spa });
            trackerResponses.push({ step: at, status: 200 });
            await route.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: script }).catch(() => undefined);
            return;
          }
          const response = await route.fetch().catch(() => null);
          trackerResponses.push({ step: at, status: response ? response.status() : 0 });
          if (response) await route.fulfill({ response }).catch(() => undefined);
          else await route.abort().catch(() => undefined);
          return;
        }
        // Nothing else may reach a Sealmetrics origin from a simulation.
        await route.abort().catch(() => undefined);
        return;
      }
      await route.continue().catch(() => undefined);
    });

    page = await context.newPage();
    page.on("console", (msg: { type(): string; text(): string }) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err: Error) => consoleErrors.push(`Uncaught: ${err.message}`));

    const tagCount = () =>
      page.evaluate(
        ([o, p]: [string[], string]) =>
          Array.from(document.querySelectorAll("script[src]")).filter((s) => {
            try {
              const u = new URL((s as HTMLScriptElement).src, location.href);
              return o.includes(u.origin) && u.pathname === p;
            } catch {
              return false;
            }
          }).length,
        [[...origins], snippetPath],
      );

    try {
      for (const s of flow.steps) {
        if (Date.now() > deadline) {
          checks.push({ code: "SP-00", result: "fail", message: `Flow stopped after ${stepsRun} steps: out of time (${Math.round(budgetMs / 1000)} s).` });
          break;
        }
        step++;
        page.setDefaultTimeout(remaining());

        if (s.goto !== undefined) {
          await page.goto(new URL(s.goto, base).href, { waitUntil: "load", timeout: remaining() });
          // SP-01 — the Sealmetrics tag exactly once.
          const count = await tagCount();
          if (count !== 1) {
            checks.push({
              code: "SP-01",
              result: "fail",
              message: count === 0 ? `No Sealmetrics tracker tag on ${s.goto}.` : `${count} Sealmetrics tracker tags on ${s.goto}: every pageview is sent ${count} times.`,
            });
          }
          // SP-02 — the tracker actually loaded on this page.
          const loaded = await page
            .waitForFunction(
              () => {
                const sm = (window as unknown as { sealmetrics?: { conv?: unknown; sessionId?: unknown } }).sealmetrics;
                return typeof sm?.conv === "function" && sm.sessionId !== undefined;
              },
              undefined,
              { timeout: Math.min(PAGE_LIMITS.hitWaitMs + delay, remaining()) },
            )
            .then(() => true)
            .catch(() => false);
          if (!loaded && count > 0) {
            const refused = trackerResponses.find((r) => r.step === step && (r.status >= 400 || r.status === 0));
            checks.push({
              code: "SP-02",
              result: "fail",
              message: refused
                ? `The tracker request failed (${refused.status || "network error"}) on ${s.goto}. /t.js answers 403 to a domain the site does not list.`
                : `The tracker never loaded on ${s.goto}: window.sealmetrics is not the tracker.`,
            });
          }
        }
        if (s.fill) await page.fill(s.fill.selector, s.fill.value, { timeout: remaining() });
        if (s.click) await page.click(s.click, { timeout: remaining() });
        if (s.submit) await page.$eval(s.submit, (form: HTMLFormElement) => form.requestSubmit());
        if (s.wait_ms) await page.waitForTimeout(Math.min(s.wait_ms, 10_000, remaining()));

        // A redirect or a click can take the page off the dev server; stop there.
        const current = new URL(page.url());
        if (current.origin !== base.origin && current.protocol !== "about:") {
          checks.push({ code: "SP-00", result: "fail", message: `Step ${step} left the dev server for ${current.origin}; the flow stops there.` });
          stepsRun++;
          break;
        }

        if (s.expect_hit) {
          const want = s.expect_hit;
          const matches = () =>
            captured.filter((c) => {
              if (c.step !== step || c.kind !== "event" || !c.mirror.payload) return false;
              const e = typeof c.mirror.payload.e === "string" ? c.mirror.payload.e : "";
              return want.e === undefined ? e === "" : e === want.e && (want.m === undefined || Boolean(c.mirror.stored_as?.is_micro) === want.m);
            }).length;
          const until = Date.now() + Math.min(PAGE_LIMITS.hitWaitMs, remaining());
          while (matches() === 0 && Date.now() < until) await page.waitForTimeout(100);
          await page.waitForTimeout(Math.min(800, remaining()));
          const n = matches();
          const label = want.e ?? "pageview";
          checks.push(
            n === 1
              ? { code: "SP-05", result: "pass", message: `Step ${step}: one '${label}' hit.` }
              : { code: "SP-05", result: "fail", message: n === 0 ? `Step ${step}: no '${label}' hit within ${PAGE_LIMITS.hitWaitMs / 1000} s.` : `Step ${step}: ${n} '${label}' hits for one action; every one is stored.` },
          );
        }
        if (s.expect_pageviews !== undefined) {
          await page.waitForTimeout(Math.min(PAGE_LIMITS.settleMs, remaining()));
          const n = captured.filter(isPageviewHit).length;
          checks.push(
            n === s.expect_pageviews
              ? { code: "SP-06", result: "pass", message: `Step ${step}: ${n} pageviews so far, as expected.` }
              : { code: "SP-06", result: "fail", message: `Step ${step}: ${n} pageviews so far, expected ${s.expect_pageviews}.${n > s.expect_pageviews ? " Something counts pages twice: a manual pageview on route change while the tracker already records them (PRD-034), or a duplicated tag." : ""}` },
          );
        }
        stepsRun++;
      }
    } catch (e) {
      checks.push({ code: "SP-00", result: "fail", message: `Step ${step} failed: ${String((e as Error)?.message ?? e).split("\n")[0]}` });
    }

    // SP-03 — an enforced CSP blocking a Sealmetrics origin, or the inline stub the plan relies on.
    const blocked = cspViolations.filter((v) => [...origins].some((o) => v.includes(o)) || (plan.loader.stub && / blocked inline$/.test(v)));
    if (blocked.length) {
      checks.push({
        code: "SP-03",
        result: "fail",
        message: `The page's Content-Security-Policy blocks Sealmetrics: ${[...new Set(blocked)].slice(0, 3).join("; ")}.`,
        fix: "Allow https://t.sealmetrics.com in script-src and connect-src (and the inline stub, by nonce or hash, when it is used).",
      });
    }

    // SP-04 — console errors that come from the tracker or from calls to it.
    const hosts = [...origins].map((o) => new URL(o).host);
    const fromTracker = consoleErrors.filter((t) => /\bsealmetrics\b/i.test(t) || hosts.some((h) => t.includes(h)));
    for (const t of fromTracker.slice(0, 3)) {
      checks.push({ code: "SP-04", result: "fail", message: `Console error: ${t.slice(0, 200)}`, fix: /not defined/.test(t) ? "Inline the queue stub in <head> before the tracker, or call only after it loads." : undefined });
    }
    if (!fromTracker.length && consoleErrors.length) {
      checks.push({ code: "SP-04", result: "info", message: `${consoleErrors.length} console error(s) unrelated to Sealmetrics.` });
    }

    // A flow with nothing to expect proves nothing.
    if (!flow.steps.some((s) => s.expect_hit || s.expect_pageviews !== undefined)) {
      checks.push({ code: "SP-00", result: "warn", message: `Flow '${flow.event}' has no expect_hit or expect_pageviews step, so it only checks the tag, the load and the console.` });
    }

    // Payload checks on the flow's own event.
    const planned = plan.events.find((e) => e.name === flow.event.trim().toLowerCase());
    if (flow.event.trim().toLowerCase() !== "pageview" && !planned) {
      checks.push({ code: "SM-00", result: "fail", message: `'${flow.event}' is not in the approved plan (not_in_plan).` });
    } else if (planned && planned.kind !== "pageview") {
      const own = captured.find((c) => c.kind === "event" && c.mirror.payload?.e === planned.name);
      if (own) checks.push(...checkPayload(planned, own.mirror));
    }

    if (checks.some((k) => k.result === "fail") && input.screenshot_dir) {
      try {
        mkdirSync(input.screenshot_dir, { recursive: true });
        const file = join(input.screenshot_dir, `${flow.event.replace(/[^\w-]/g, "_")}-${Date.now()}.png`);
        writeFileSync(file, await page.screenshot({ fullPage: true, timeout: 5_000 }));
        screenshot = file;
      } catch {
        screenshot = undefined;
      }
    }
  } finally {
    await context.close().catch(() => undefined);
  }

  const hits: PageHit[] = captured
    .filter((c) => c.kind === "event")
    .map((c) => {
      const hit: PageHit = { step: c.step, body_bytes: c.mirror.body_bytes, rejection: c.mirror.rejection };
      if (c.mirror.payload) {
        const { a: _a, s: _s, t: _t, z: _z, c: _c, ...rest } = c.mirror.payload;
        hit.payload = rest;
      }
      if (c.mirror.stored_as) hit.stored_as = c.mirror.stored_as;
      return hit;
    });

  return {
    event: flow.event,
    verdict: checks.some((k) => k.result === "fail") ? "fail" : "pass",
    steps_run: stepsRun,
    hits,
    checks,
    console_errors: consoleErrors.slice(0, 10),
    ...(screenshot ? { screenshot } : {}),
  };
}
