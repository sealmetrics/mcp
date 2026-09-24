/**
 * PRD-058 F3 — page-level simulation in a real browser against test-site/sim.
 * Skipped, with a visible reason, when no Chromium-based browser can be launched:
 * playwright-core is optional and CI has no browser installed yet.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { planInstall } from "../src/plan/index.js";
import { simulatePage, type PageFlow } from "../src/simulate/page/index.js";
import { resolveBrowser } from "../src/simulate/page/browser.js";
import { DOMAINS, ecommercePlan } from "./helpers/plans.js";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..", "..", "test-site");

const probe = await resolveBrowser();
if (probe.ok) await probe.browser.close();
const available = probe.ok;

let server: Server;
let other: Server;
let base = "";

beforeAll(async () => {
  if (!available) return;
  server = createServer((req, res) => {
    const path = join(site, decodeURIComponent((req.url ?? "/").split("?")[0]));
    if (existsSync(path) && !path.endsWith("/")) {
      res.writeHead(200, { "content-type": extname(path) === ".html" ? "text/html; charset=utf-8" : "text/plain" });
      res.end(readFileSync(path));
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><title>SPA route</title>");
    }
  });
  // A second origin, to prove a redirect off the dev server stops the flow.
  other = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!DOCTYPE html><title>elsewhere</title>");
  });
  await new Promise<void>((r) => other.listen(0, "127.0.0.1", () => r()));
  const otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}/`;
  const inner = server.listeners("request")[0] as (req: unknown, res: unknown) => void;
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    if (req.url === "/sim/redirect") {
      res.writeHead(302, { location: otherUrl });
      res.end();
      return;
    }
    inner(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (other) await new Promise<void>((r) => other.close(() => r()));
});

const plan = ecommercePlan();
const planId = planInstall(plan, { siteDomains: DOMAINS }).plan_id;
const run = (flows: PageFlow[], extra: Record<string, unknown> = {}) =>
  simulatePage({ plan, plan_id: planId, base_url: base, flows, ...extra });
const codes = (r: Awaited<ReturnType<typeof run>>, result = "fail") =>
  r.flows.flatMap((f) => f.checks.filter((c) => c.result === result).map((c) => c.code));

describe("page simulation — input guards (no browser needed)", () => {
  it("refuses a remote base_url without allow_remote_url", async () => {
    const r = await simulatePage({ plan, plan_id: planId, base_url: "https://demo-store.com", flows: [{ event: "pageview", steps: [{ goto: "/" }] }] });
    expect(r).toMatchObject({ status: "invalid_input" });
    expect(r.message).toContain("allow_remote_url");
  });

  it("refuses a plan changed after approval", async () => {
    const r = await simulatePage({ plan, plan_id: "000000000000", base_url: "http://localhost:3000", flows: [{ event: "pageview", steps: [{ goto: "/" }] }] });
    expect(r.status).toBe("stale_plan");
  });

  it("validates each flow before launching a browser", async () => {
    const r = await simulatePage({ plan, plan_id: planId, base_url: "http://localhost:3000", flows: [{ steps: [{ goto: "/" }] } as unknown as PageFlow] });
    expect(r).toMatchObject({ status: "invalid_input" });
    expect(r.message).toMatch(/event/);
  });

  it("caps the steps of a flow", async () => {
    const steps = Array.from({ length: 21 }, () => ({ wait_ms: 1 }));
    const r = await simulatePage({ plan, plan_id: planId, base_url: "http://localhost:3000", flows: [{ event: "pageview", steps }] });
    expect(r.status).toBe("invalid_input");
  });
});

describe.skipIf(!available)(`page simulation in ${probe.ok ? probe.source : "no browser"} (RF-F3)`, () => {
  it("a correct install passes, and no hit leaves the browser", async () => {
    const r = await run([
      { event: "add_to_cart", steps: [{ goto: "/sim/good.html", expect_pageviews: 1 }, { click: "#add", expect_hit: { e: "add_to_cart", m: true } }] },
      { event: "purchase", steps: [{ goto: "/sim/good.html" }, { click: "#buy", expect_hit: { e: "purchase" } }] },
    ]);
    expect(r.status).toBe("ok");
    expect(codes(r)).toEqual([]);
    expect(r.verdict).toBe("pass");
    const purchase = r.flows[1].hits.find((h) => h.payload?.e === "purchase");
    expect(purchase?.stored_as?.amount).toBe(149.99);
    expect(r.wording).toMatch(/not verified/);
    expect(r.browser?.version).toBeTruthy();
  }, 60_000);

  it("SP-04 / SP-05: conv() before a deferred tracker without the stub is lost", async () => {
    const r = await run([{ event: "purchase", steps: [{ goto: "/sim/no-stub.html", expect_hit: { e: "purchase" } }] }]);
    expect(codes(r)).toEqual(expect.arrayContaining(["SP-04", "SP-05"]));
    expect(r.flows[0].checks.find((c) => c.code === "SP-04")?.message).toMatch(/sealmetrics is not defined/);
  }, 60_000);

  it("SP-02 / SP-03: a CSP that blocks the tracker", async () => {
    const r = await run([{ event: "pageview", steps: [{ goto: "/sim/csp.html" }] }]);
    expect(codes(r)).toEqual(expect.arrayContaining(["SP-02", "SP-03"]));
  }, 60_000);

  it("SP-06: a manual pageview on a pushState navigation counts it twice", async () => {
    const r = await run([{ event: "pageview", steps: [{ goto: "/sim/double-spa.html" }, { click: "#nav", expect_pageviews: 2 }] }]);
    const sp06 = r.flows[0].checks.find((c) => c.code === "SP-06");
    expect(sp06?.result).toBe("fail");
    expect(sp06?.message).toMatch(/3 pageviews so far, expected 2/);
  }, 60_000);

  it("SP-01: the tracker tag twice", async () => {
    const r = await run([{ event: "pageview", steps: [{ goto: "/sim/duplicate.html", expect_pageviews: 1 }] }]);
    expect(codes(r)).toEqual(expect.arrayContaining(["SP-01", "SP-06"]));
  }, 60_000);

  it("the site's own POST /api/event is neither captured nor counted", async () => {
    const r = await run([{ event: "pageview", steps: [{ goto: "/sim/own-event.html", expect_pageviews: 1 }] }]);
    expect(r.verdict).toBe("pass");
    expect(r.flows[0].hits).toHaveLength(1);
  }, 60_000);

  it("a redirect off the dev server stops the flow", async () => {
    const r = await run([{ event: "pageview", steps: [{ goto: "/sim/redirect" }, { goto: "/sim/good.html", expect_pageviews: 1 }] }]);
    const sp00 = r.flows[0].checks.find((c) => c.code === "SP-00");
    expect(sp00?.message).toMatch(/left the dev server/);
    expect(r.flows[0].steps_run).toBe(1);
  }, 60_000);

  it("tracker_delay_ms: with a slow tracker the correct page still passes (PRD-050 RF-006)", async () => {
    const r = await run(
      [{ event: "add_to_cart", steps: [{ goto: "/sim/good.html" }, { click: "#add", expect_hit: { e: "add_to_cart", m: true } }] }],
      { tracker_delay_ms: 1500 },
    );
    expect(r.verdict).toBe("pass");
    expect(r.tracker.delay_ms).toBe(1500);
  }, 60_000);

  it("SP-07: a failed flow leaves a screenshot where asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sim-shots-"));
    const r = await run([{ event: "pageview", steps: [{ goto: "/sim/csp.html" }] }], { screenshot_dir: dir });
    expect(r.flows[0].screenshot).toBeTruthy();
    expect(readdirSync(dir).some((f) => f.endsWith(".png"))).toBe(true);
  }, 60_000);
});
