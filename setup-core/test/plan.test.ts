import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planInstall } from "../src/plan/index.js";
import { computePlanId, normalizePlan, parseSnippetUrl } from "../src/plan/normalize.js";
import type { InstallPlanInput } from "../src/plan/types.js";
import { DOMAINS, ecommercePlan } from "./helpers/plans.js";

const run = (plan: InstallPlanInput, domains: string[] | null = DOMAINS) => planInstall(plan, { siteDomains: domains });
const codes = (plan: InstallPlanInput, code: string, domains: string[] | null = DOMAINS) =>
  run(plan, domains).findings.filter((f) => f.code === code);
const clone = (p: InstallPlanInput): InstallPlanInput => JSON.parse(JSON.stringify(p));

describe("plan identity (RF-B1)", () => {
  it("the base plan is ok and lists the files to edit", () => {
    const r = run(ecommercePlan());
    expect(r.status).toBe("ok");
    expect(r.findings.filter((f) => f.severity === "block")).toEqual([]);
    expect(r.plan_id).toMatch(/^[0-9a-f]{12}$/);
    expect(r.files_to_edit).toContain("app/checkout/success/page.tsx");
    expect(r.summary_markdown).toContain(r.plan_id);
  });

  it("plan_id ignores key order and event order", () => {
    const a = ecommercePlan();
    const b = clone(a);
    b.events.reverse();
    b.events[0] = Object.fromEntries(Object.entries(b.events[0]).reverse()) as typeof b.events[0];
    expect(computePlanId(normalizePlan(a))).toBe(computePlanId(normalizePlan(b)));
  });

  it("plan_id changes on any real change", () => {
    const a = ecommercePlan();
    const b = clone(a);
    b.events[3].properties!.currency.example = "USD";
    expect(computePlanId(normalizePlan(a))).not.toBe(computePlanId(normalizePlan(b)));
  });

  it("derives auto/spa from the snippet URL exactly like tracker.go", () => {
    expect(parseSnippetUrl("https://t.sealmetrics.com/t.js?id=a&auto=0&spa=0")).toMatchObject({ auto: false, spa: false });
    expect(parseSnippetUrl("https://t.sealmetrics.com/t.js?id=a&auto=false&spa=")).toMatchObject({ auto: true, spa: true });
    expect(parseSnippetUrl('<script src="https://t.sealmetrics.com/t.js?id=a&group=blog" defer></script>')).toMatchObject({ id: "a", group: "blog" });
  });
});

describe("rules PL-01…PL-17 (RF-B2)", () => {
  it("PL-01 blocks a name outside the taxonomy, with a suggestion", () => {
    const p = ecommercePlan();
    p.events[0].name = "product_view";
    expect(codes(p, "PL-01")[0]).toMatchObject({ severity: "block", event: "product_view" });
    expect(codes(ecommercePlan(), "PL-01")).toEqual([]);
  });

  it("PL-02 blocks order_id, including inside list items (DEC-01)", () => {
    const p = ecommercePlan();
    p.events[3].properties!.items.item!.order_id = "string";
    expect(codes(p, "PL-02")[0]?.message).toContain("items[0].order_id");
    const q = ecommercePlan();
    q.events[3].properties!.order_id = { type: "string" };
    expect(codes(q, "PL-02")).toHaveLength(1);
    expect(codes(ecommercePlan(), "PL-02")).toEqual([]);
  });

  it("PL-03 blocks an example that looks like an email or a phone, not an EAN", () => {
    const p = ecommercePlan();
    p.events[1].properties!.note = { type: "string", example: "ana@example.com" };
    expect(codes(p, "PL-03")[0]?.severity).toBe("block");
    const ean = ecommercePlan();
    ean.events[0].properties!.product_id.example = "8412345678905";
    expect(codes(ean, "PL-03")).toEqual([]);
  });

  it("PL-04 blocks a purchase without revenue and warns on a string amount", () => {
    const p = ecommercePlan();
    delete p.events[3].value;
    expect(codes(p, "PL-04")[0]?.severity).toBe("block");
    const s = ecommercePlan();
    s.events[3].value = { source: "order.total", example: "149.99" };
    expect(codes(s, "PL-04")[0]).toMatchObject({ severity: "warn" });
    expect(codes(s, "PL-04")[0].fix).toContain("Number(order.total)");
    expect(codes(ecommercePlan(), "PL-04")).toEqual([]);
  });

  it("PL-05 warns on revenue without currency", () => {
    const p = ecommercePlan();
    delete p.events[3].properties!.currency;
    expect(codes(p, "PL-05")).toHaveLength(1);
    expect(codes(ecommercePlan(), "PL-05")).toEqual([]);
  });

  it("PL-06 blocks a missing or inconsistent product identifier in ecommerce", () => {
    const p = ecommercePlan({ product_identifier: undefined });
    expect(codes(p, "PL-06")[0]?.severity).toBe("block");
    const q = ecommercePlan();
    delete q.events[1].properties!.product_id;
    expect(codes(q, "PL-06")[0]?.event).toBe("add_to_cart");
    const hotel = ecommercePlan({ vertical: "hotel", product_identifier: undefined });
    expect(codes(hotel, "PL-06")[0]?.severity).toBe("warn");
    expect(codes(ecommercePlan(), "PL-06")).toEqual([]);
  });

  it("PL-07 warns on the same event planned twice at the same place", () => {
    const p = ecommercePlan();
    p.events.push(clone(ecommercePlan()).events[1]);
    expect(codes(p, "PL-07")).toHaveLength(1);
    expect(codes(ecommercePlan(), "PL-07")).toEqual([]);
  });

  it("PL-08 blocks a manual route pageview while spa=1 (PRD-034), not with spa=0", () => {
    const p = ecommercePlan();
    p.events.push({ kind: "pageview", trigger: { type: "route", where: "app/providers.tsx" } });
    expect(codes(p, "PL-08")[0]?.severity).toBe("block");
    const q = clone(p);
    q.loader.snippet_url += "&spa=0";
    expect(codes(q, "PL-08")).toEqual([]);
  });

  it("PL-09 blocks auto=0 without a manual pageview, and warns on spa=0 without route pageviews", () => {
    const p = ecommercePlan();
    p.loader.snippet_url += "&auto=0";
    expect(codes(p, "PL-09")[0]?.severity).toBe("block");
    const q = ecommercePlan();
    q.loader.snippet_url += "&spa=0";
    expect(codes(q, "PL-09")[0]?.severity).toBe("warn");
    expect(codes(ecommercePlan(), "PL-09")).toEqual([]);
  });

  it("PL-10 warns on data-layer triggers without the stub", () => {
    const p = ecommercePlan();
    p.events[2].trigger = { type: "datalayer", where: "checkout_step" };
    expect(codes(p, "PL-10")).toHaveLength(1);
    p.loader.stub = true;
    expect(codes(p, "PL-10")).toEqual([]);
  });

  it("PL-11 blocks a domain the site does not list; subdomains pass; unknown is info", () => {
    expect(codes(ecommercePlan(), "PL-11", ["other.com"])[0]?.severity).toBe("block");
    const sub = ecommercePlan({ site: { domain: "shop.demo-store.com" } });
    expect(codes(sub, "PL-11")).toEqual([]);
    expect(codes(ecommercePlan({ site: { domain: "www.demo-store.com" } }), "PL-11")).toEqual([]);
    expect(codes(ecommercePlan(), "PL-11", null)[0]?.severity).toBe("info");
  });

  it("PL-11 blocks a www.-listed site exactly like pixel-service (the list keeps www., the hit loses it)", () => {
    const f = codes(ecommercePlan({ site: { domain: "www.demo-store.com" } }), "PL-11", ["www.demo-store.com"])[0];
    expect(f?.severity).toBe("block");
    // The message explains the mismatch without naming an internal document:
    // the mirror of this package is public (see directory-annotations.test.ts).
    expect(f?.message).toContain("invalid_domain");
    expect(f?.message).not.toMatch(/docs\/prd\/|CLAUDE\.md/);
    expect(f?.fix).toContain("'demo-store.com'");
  });

  it("PL-06 warns when the examples give one product different identifiers", () => {
    const p = ecommercePlan();
    p.events[1].properties!.product_id.example = "sku_123";
    expect(codes(p, "PL-06").find((f) => f.severity === "warn")?.message).toContain("add_to_cart=sku_123");
  });

  it("PL-16 blocks a group /t.js answers 400 to", () => {
    const p = ecommercePlan();
    p.loader.snippet_url += "&group=checkout%20page";
    expect(codes(p, "PL-16")[0]?.message).toContain("400");
  });

  it("PL-12 warns near the 15 KB body limit and blocks over it", () => {
    const p = ecommercePlan();
    p.events[3].properties!.items.max_items = 200;
    const f = codes(p, "PL-12")[0];
    expect(f?.severity).toBe("block");
    expect(f?.fix).toMatch(/Cap the list at \d+ items/);
    expect(codes(ecommercePlan(), "PL-12")).toEqual([]);
  });

  it("PL-13 / PL-14 read the repo: an existing loader and unplanned calls", () => {
    const repo = mkdtempSync(join(tmpdir(), "plan-repo-"));
    mkdirSync(join(repo, "app"), { recursive: true });
    mkdirSync(join(repo, "node_modules", "x"), { recursive: true });
    writeFileSync(join(repo, "app", "legacy.html"), '<script src="https://t.sealmetrics.com/t.js?id=acct_demo" defer></script>\n');
    writeFileSync(join(repo, "app", "form.tsx"), "export const f = () => sealmetrics.conv('lead', 0, { form_name: 'x' });\n");
    writeFileSync(join(repo, "node_modules", "x", "i.js"), "sealmetrics.micro('ignored_dep');\n");
    const r = run({ ...ecommercePlan(), repo_path: repo });
    expect(r.findings.find((f) => f.code === "PL-13")?.message).toContain("app/legacy.html:1");
    const pl14 = r.findings.filter((f) => f.code === "PL-14");
    expect(pl14.map((f) => f.event)).toEqual(["lead"]);
    expect(r.checked.repo).toBe(true);
  });

  it("PL-15 notes missing funnel stages", () => {
    const p = ecommercePlan();
    p.events.splice(2, 1);
    expect(codes(p, "PL-15")[0]?.message).toContain("begin_checkout");
  });

  it("PL-16 blocks another account's snippet and contradictory flags; warns on a proxy host", () => {
    const p = ecommercePlan();
    p.loader.snippet_url = "https://t.sealmetrics.com/t.js?id=acct_other";
    expect(codes(p, "PL-16")[0]?.severity).toBe("block");
    const q = ecommercePlan();
    q.loader.spa_pageview = false;
    expect(codes(q, "PL-16")[0]?.fix).toContain("&spa=0");
    const proxy = ecommercePlan();
    proxy.loader.snippet_url = "https://demo-store.com/sm/t.js?id=acct_demo";
    expect(codes(proxy, "PL-16")[0]?.severity).toBe("warn");
    expect(codes(ecommercePlan(), "PL-16")).toEqual([]);
  });

  it("PL-17 notes non-snake_case keys", () => {
    const p = ecommercePlan();
    p.events[0].properties!.productName = { type: "string", example: "x" };
    expect(codes(p, "PL-17")[0]?.severity).toBe("info");
  });

  it("status is blocked when any block finding exists, and next_step says not to propose it", () => {
    const p = ecommercePlan();
    p.events[0].name = "product_view";
    const r = run(p);
    expect(r.status).toBe("blocked");
    expect(r.next_step).toMatch(/Do not show a blocked plan/);
    expect(r.findings[0].severity).toBe("block");
  });
});
