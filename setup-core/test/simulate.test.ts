import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planInstall } from "../src/plan/index.js";
import { normalizePlan } from "../src/plan/normalize.js";
import type { InstallPlanInput } from "../src/plan/types.js";
import { runScenario, simulateInstall, type SimulationCase } from "../src/simulate/index.js";
import { buildTrackerScript, sanitizeJSString } from "../src/simulate/sandbox.js";
import { TRACKER_CODE } from "../src/generated/tracker.js";
import { DOMAINS, ecommercePlan } from "./helpers/plans.js";

const planIdOf = (plan: InstallPlanInput) => planInstall(plan, { siteDomains: DOMAINS }).plan_id;

function simulate(plan: InstallPlanInput, cases: SimulationCase[] = [], extra: { scenarios?: Parameters<typeof simulateInstall>[0]["scenarios"] } = {}) {
  return simulateInstall({ plan, plan_id: planIdOf(plan), cases, ...extra }, { siteDomains: DOMAINS });
}

const check = (r: ReturnType<typeof simulate>, event: string, code: string) =>
  r.cases.find((c) => c.event === event)?.checks.filter((k) => k.code === code) ?? [];

const PURCHASE_VARS = { order: { total: 149.99, currency: "EUR", items: [{ sku: "SKU-123", qty: 1, unitPrice: 99.99 }] } };
const PURCHASE_CODE =
  "sealmetrics.conv('purchase', order.total, { currency: order.currency, items: order.items.map(i => ({ product_id: i.sku, quantity: i.qty, price: i.unitPrice })) })";

describe("sandbox runs the tracker production serves (RF-C1)", () => {
  it("injects placeholders like tracker.go and leaves none behind", () => {
    const script = buildTrackerScript({ accountId: "acct_demo", group: "blog", auto: false, spa: true });
    expect(script).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(TRACKER_CODE).toContain("{{ACCOUNT_ID}}");
    expect(sanitizeJSString("a'b</script>")).toBe("a\\'b<\\/script>");
  });
});

describe("simulateInstall (RF-C3/C4)", () => {
  it("a clean plan with synthetic cases passes, and says it is not a verification", () => {
    const r = simulate(ecommercePlan());
    expect(r.status).toBe("ok");
    expect(r.verdict).toBe("pass");
    expect(r.cases.map((c) => c.event).sort()).toEqual(["add_to_cart", "begin_checkout", "purchase", "view_item"]);
    expect(r.cases.every((c) => c.synthetic)).toBe(true);
    expect(r.simulation_id).toMatch(/^sim_[0-9a-f]{12}$/);
    expect(r.wording).toMatch(/not verified/);
    expect(r.scenarios.find((s) => s.name === "load")?.pageviews).toBe(1);
    expect(r.scenarios.find((s) => s.name === "spa_navigation")?.pageviews).toBe(3);
  });

  it("is deterministic", () => {
    const a = simulate(ecommercePlan(), [{ event: "purchase", code: PURCHASE_CODE, vars: PURCHASE_VARS }]);
    const b = simulate(ecommercePlan(), [{ event: "purchase", code: PURCHASE_CODE, vars: PURCHASE_VARS }]);
    expect(b).toEqual(a);
  });

  it("refuses a plan that changed after approval (stale_plan)", () => {
    const plan = ecommercePlan();
    const approved = planIdOf(plan);
    plan.events[3].properties!.currency.example = "USD";
    const r = simulateInstall({ plan, plan_id: approved }, { siteDomains: DOMAINS });
    expect(r.status).toBe("stale_plan");
    expect(r.simulation_id).toBeNull();
    expect(r.verdict).toBe("fail");
  });

  it("refuses a blocked plan (blocked_plan)", () => {
    const plan = ecommercePlan();
    plan.events[0].name = "product_view";
    const r = simulate(plan);
    expect(r.status).toBe("blocked_plan");
    expect(r.findings?.[0].code).toBe("PL-01");
  });

  it("SM-04: a string total is sent without an amount; Number() fixes it", () => {
    const vars = { order: { ...PURCHASE_VARS.order, total: "149.99" } };
    const bad = simulate(ecommercePlan(), [{ event: "purchase", code: PURCHASE_CODE, vars }]);
    expect(bad.verdict).toBe("fail");
    expect(check(bad, "purchase", "SM-04")[0]).toMatchObject({ result: "fail" });
    expect(check(bad, "purchase", "SM-04")[0].message).toContain("got string '149.99'");
    expect(bad.cases.find((c) => c.event === "purchase")?.hits[0].stored_as?.amount).toBe(0);

    const fixed = simulate(ecommercePlan(), [{ event: "purchase", code: PURCHASE_CODE.replace("order.total", "Number(order.total)"), vars }]);
    expect(check(fixed, "purchase", "SM-04")[0].result).toBe("pass");
    expect(fixed.verdict).toBe("pass");
  });

  it("SM-11 shows what pixel-service stores: items as Go-marshalled JSON with sorted keys", () => {
    const r = simulate(ecommercePlan(), [{ event: "purchase", code: PURCHASE_CODE, vars: PURCHASE_VARS }]);
    const stored = r.cases.find((c) => c.event === "purchase")!.hits[0].stored_as!;
    expect(stored).toMatchObject({ event_type: "conversion", amount: 149.99, is_micro: false });
    expect(stored.properties.items).toBe('[{"price":99.99,"product_id":"SKU-123","quantity":1}]');
  });

  it("SM-00: an event outside the approved plan is not simulated", () => {
    const r = simulate(ecommercePlan(), [{ event: "newsletter_signup", code: "sealmetrics.micro('newsletter_signup')" }]);
    expect(check(r, "newsletter_signup", "SM-00")[0].message).toContain("not_in_plan");
    expect(r.verdict).toBe("fail");
  });

  it("SM-02: a call before the tracker loads throws without the stub, and is queued with it", () => {
    const code = "sealmetrics.micro('add_to_cart', { product_id: 'SKU-123', quantity: 1 })";
    const noStub = simulate(ecommercePlan(), [{ event: "add_to_cart", code, context: { before_tracker_load: true } }]);
    expect(check(noStub, "add_to_cart", "SM-02")[0].message).toContain("sealmetrics is not defined");

    const plan = ecommercePlan();
    plan.loader.stub = true;
    const withStub = simulate(plan, [{ event: "add_to_cart", code, context: { before_tracker_load: true } }]);
    expect(withStub.cases.find((c) => c.event === "add_to_cart")?.verdict).toBe("pass");
    expect(withStub.scenarios.find((s) => s.name === "stub_queue")?.verdict).toBe("pass");
  });

  it("SM-01: optional chaining before load loses the event silently", () => {
    const code = "window.sealmetrics?.micro('add_to_cart', { product_id: 'SKU-123', quantity: 1 })";
    const r = simulate(ecommercePlan(), [{ event: "add_to_cart", code, context: { before_tracker_load: true } }]);
    expect(check(r, "add_to_cart", "SM-01")[0].message).toMatch(/optional chaining/);
  });

  it("SM-03: a planned micro written as a conversion", () => {
    const r = simulate(ecommercePlan(), [{ event: "add_to_cart", code: "sealmetrics.conv('add_to_cart', 0, { product_id: 'SKU-123', quantity: 1 })" }]);
    expect(check(r, "add_to_cart", "SM-03")[0]).toMatchObject({ result: "fail" });
    expect(check(r, "add_to_cart", "SM-03")[0].message).toContain("the plan says micro 'add_to_cart'");
  });

  it("SM-01: two hits for one action", () => {
    const code = "sealmetrics.micro('add_to_cart', { product_id: 'S', quantity: 1 }); sealmetrics.micro('add_to_cart', { product_id: 'S', quantity: 1 });";
    const r = simulate(ecommercePlan(), [{ event: "add_to_cart", code }]);
    expect(check(r, "add_to_cart", "SM-01")[0].message).toContain("2 hits");
  });

  it("SM-05 / SM-06: a missing planned property, and PII the plan never declared", () => {
    const code = "sealmetrics.micro('view_item', { product_id: 'SKU-123', contact: 'ana@example.com' })";
    const r = simulate(ecommercePlan(), [{ event: "view_item", code }]);
    const sm05 = check(r, "view_item", "SM-05");
    expect(sm05.find((k) => k.result === "fail")?.message).toContain("price");
    expect(sm05.find((k) => k.result === "warn")?.message).toContain("contact");
    expect(check(r, "view_item", "SM-06")[0].message).toContain("contact (email_value)");
  });

  it("SM-07 / SM-08: an oversized purchase is truncated and rejected as invalid_json", () => {
    const items = Array.from({ length: 150 }, (_, i) => ({ sku: `SKU-${i}-${"x".repeat(40)}`, qty: 1, unitPrice: 10.5 }));
    const r = simulate(ecommercePlan(), [{ event: "purchase", code: PURCHASE_CODE, vars: { order: { ...PURCHASE_VARS.order, items } } }]);
    expect(check(r, "purchase", "SM-07")[0].result).toBe("fail");
    expect(check(r, "purchase", "SM-08")[0].message).toContain("invalid_json");
  });

  it("SM-08: a hit from localhost is rejected as invalid_domain", () => {
    const code = "sealmetrics.micro('view_item', { product_id: 'SKU-123', price: 19.9 })";
    const r = simulate(ecommercePlan(), [{ event: "view_item", code, context: { url: "http://localhost:3000/products/x" } }]);
    expect(check(r, "view_item", "SM-08")[0].message).toContain("invalid_domain");
    const unknown = simulateInstall({ plan: ecommercePlan(), plan_id: planIdOf(ecommercePlan()) }, { siteDomains: null });
    expect(unknown.not_simulated).toContain("invalid_domain");
  });

  it("SM-09: the product identifier differs between cases", () => {
    const r = simulate(ecommercePlan(), [
      { event: "view_item", code: "sealmetrics.micro('view_item', { product_id: 'SKU-123', price: 19.9 })" },
      { event: "add_to_cart", code: "sealmetrics.micro('add_to_cart', { product_id: 'sku_123', quantity: 1 })" },
    ]);
    expect(check(r, "view_item", "SM-09")[0]).toMatchObject({ result: "warn" });
  });

  it("SM-10: warns when the simulated call is not in the file on disk", () => {
    const repo = mkdtempSync(join(tmpdir(), "sim-repo-"));
    mkdirSync(join(repo, "components"));
    writeFileSync(join(repo, "components", "AddToCart.tsx"), "export const x = () => null;\n");
    const plan = { ...ecommercePlan(), repo_path: repo };
    const r = simulateInstall(
      {
        plan,
        plan_id: planIdOf(plan),
        cases: [{ event: "add_to_cart", code: "sealmetrics.micro('add_to_cart', { product_id: 'S', quantity: 1 })", source: { file: "components/AddToCart.tsx", line: 1 } }],
      },
      { siteDomains: DOMAINS },
    );
    expect(r.cases.find((c) => c.event === "add_to_cart")?.checks.find((k) => k.code === "SM-10")?.result).toBe("warn");
  });
});

describe("scenarios (RF-C3)", () => {
  it("spa_navigation fails on the PRD-034 double count", () => {
    const plan = ecommercePlan();
    plan.events.push({ kind: "pageview", trigger: { type: "route", where: "app/providers.tsx" } });
    const s = runScenario(normalizePlan(plan), "spa_navigation");
    expect(s).toMatchObject({ verdict: "fail", pageviews: 6 });
  });

  it("spa=0 with a manual route pageview counts once per navigation; spa=0 alone warns", () => {
    const plan = ecommercePlan();
    plan.loader.snippet_url += "&spa=0";
    expect(runScenario(normalizePlan(plan), "spa_navigation")).toMatchObject({ verdict: "warn", pageviews: 0 });
    plan.events.push({ kind: "pageview", trigger: { type: "route" } });
    expect(runScenario(normalizePlan(plan), "spa_navigation")).toMatchObject({ verdict: "pass", pageviews: 3 });
  });

  it("load fails with auto=0 and no manual pageview, and on a double load pageview", () => {
    const off = ecommercePlan();
    off.loader.snippet_url += "&auto=0";
    expect(runScenario(normalizePlan(off), "load")).toMatchObject({ verdict: "fail", pageviews: 0 });
    const dbl = ecommercePlan();
    dbl.events.push({ kind: "pageview", trigger: { type: "page" } });
    expect(runScenario(normalizePlan(dbl), "load")).toMatchObject({ verdict: "fail", pageviews: 2 });
  });

  it("an unknown scenario name is reported, not run as another scenario", () => {
    const s = runScenario(normalizePlan(ecommercePlan()), "loads" as never);
    expect(s.checks[0]).toMatchObject({ code: "SC-00", result: "info" });
  });

  it("stub_queue without the stub fails; iframe sends no automatic pageview", () => {
    expect(runScenario(normalizePlan(ecommercePlan()), "stub_queue").verdict).toBe("fail");
    expect(runScenario(normalizePlan(ecommercePlan()), "iframe")).toMatchObject({ verdict: "info", pageviews: 0 });
  });
});
