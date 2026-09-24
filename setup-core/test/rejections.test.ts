import { describe, it, expect } from "vitest";
import { explainRejections, fetchPixelRejections, rejectionWindowMinutes, type PixelRejections } from "../src/rejections.js";

function fakeFetch(status: number, body: unknown, seen: string[] = []): typeof fetch {
  return (async (url: string) => {
    seen.push(url);
    return { status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  }) as unknown as typeof fetch;
}

const data = (over: Partial<PixelRejections> = {}): PixelRejections => ({
  account_id: "acct_demo",
  window_minutes: 15,
  available: true,
  accepted: 0,
  rejected: 14,
  reasons: [{ reason: "invalid_domain", count: 14, origins: [{ origin: "http://localhost:3000", count: 14 }] }],
  ...over,
});

describe("fetchPixelRejections (PRD-058 F5)", () => {
  it("unwraps the envelope and clamps the window", async () => {
    const seen: string[] = [];
    const r = await fetchPixelRejections("acct demo", { baseUrl: "http://api.test/api/v1/", apiKey: "k", minutes: 5000, fetchImpl: fakeFetch(200, { success: true, data: data() }, seen) });
    expect(seen[0]).toBe("http://api.test/api/v1/sites/acct%20demo/pixel/rejections?minutes=1440");
    expect(r?.reasons[0].origins[0].origin).toBe("http://localhost:3000");
  });

  it("never throws: an API without the endpoint, a network error or a bad body is null", async () => {
    expect(await fetchPixelRejections("a", { baseUrl: "http://x", apiKey: "k", fetchImpl: fakeFetch(404, "Not Found") })).toBeNull();
    expect(await fetchPixelRejections("a", { baseUrl: "http://x", apiKey: "k", fetchImpl: fakeFetch(200, "<html>") })).toBeNull();
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await fetchPixelRejections("a", { baseUrl: "http://x", apiKey: "k", fetchImpl: boom })).toBeNull();
  });

  it("asks for the poll's duration plus 15 minutes", () => {
    expect(rejectionWindowMinutes(25_000)).toBe(16);
    expect(rejectionWindowMinutes(0)).toBe(15);
    expect(rejectionWindowMinutes(10 ** 9)).toBe(1440);
  });
});

describe("explainRejections", () => {
  it("names a local dev server rejected as invalid_domain", () => {
    const msg = explainRejections(data(), "pixel")!;
    expect(msg).toMatch(/No hit was stored in the last 15 minutes, and 14 hits were rejected/);
    expect(msg).toMatch(/invalid_domain from http:\/\/localhost:3000 — a local dev server/);
  });

  it("tells a preview deploy from an unlisted domain, and never tells to add a domain blindly", () => {
    const preview = data({ reasons: [{ reason: "invalid_domain", count: 2, origins: [{ origin: "https://shop-git-main.vercel.app", count: 2 }] }] });
    expect(explainRejections(preview, "pixel")).toMatch(/preview or staging deploy/);
    const other = data({ reasons: [{ reason: "invalid_domain", count: 2, origins: [{ origin: "https://example.com", count: 2 }] }] });
    const msg = explainRejections(other, "pixel")!;
    expect(msg).toMatch(/If it is the user's own site, add it/);
    expect(msg).toMatch(/can be forged/);
    expect(msg).toMatch(/rejects every hit, so save it without www/);
    const noOrigin = data({ reasons: [{ reason: "invalid_domain", count: 1, origins: [] }] });
    expect(explainRejections(noOrigin, "pixel")).toMatch(/without an http\(s\) address/);
  });

  it("explains bot_detected, the blocklists and a site the pixel does not know yet", () => {
    const r = data({ rejected: 4, reasons: [
      { reason: "bot_detected", count: 2, origins: [] },
      { reason: "blocklist_ip", count: 1, origins: [] },
      { reason: "invalid_account", count: 1, origins: [] },
    ] });
    const msg = explainRejections(r, "pixel")!;
    expect(msg).toMatch(/bot_detected — .*many pageviews within seconds.*up to an hour/);
    expect(msg).toMatch(/blocklist_ip — .*Sealmetrics' global IP blocklists/);
    expect(msg).toMatch(/invalid_account — .*less than 5 minutes ago/);
  });

  it("nothing logged: points at t.js refused on an unlisted domain, not only a missing snippet", () => {
    const msg = explainRejections(data({ rejected: 0, reasons: [] }), "pixel")!;
    expect(msg).toMatch(/tracker has not sent anything/);
    expect(msg).toMatch(/t\.js: a 403 means the page's domain is not one of the site's domains/);
  });

  it("for an event on a site with traffic, rejections are possible causes, not the verdict", () => {
    const quiet = explainRejections(data({ rejected: 0, reasons: [], accepted: 40 }), { event: "purchase" })!;
    expect(quiet).toMatch(/the 'purchase' call did not fire on the live site, or fired under another name\. Nothing was rejected/);
    const noisy = explainRejections(data({ accepted: 40, rejected: 3, reasons: [{ reason: "blocklist_ua", count: 3, origins: [] }] }), { event: "purchase" })!;
    expect(noisy).toMatch(/call did not fire .* or its hit was rejected\. 3 hits were rejected meanwhile, possibly other visitors'/);
  });

  it("a pixel verification that raced a stored hit says to run it again", () => {
    expect(explainRejections(data({ accepted: 2 }), "pixel")).toMatch(/the pixel works now; run the verification again/);
  });

  it("says nothing when the hit log could not be read", () => {
    expect(explainRejections(data({ available: false }), "pixel")).toBeNull();
    expect(explainRejections(null, "pixel")).toBeNull();
  });
});
