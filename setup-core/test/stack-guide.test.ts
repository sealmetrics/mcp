import { describe, it, expect } from "vitest";
import { getStackGuide, STACK_GUIDES, getPlatformPluginGuide } from "../src/stack-guide.js";
import type { Framework } from "../src/types.js";

const FRAMEWORKS: Framework[] = [
  "next-app",
  "next-pages",
  "astro",
  "remix",
  "nuxt",
  "sveltekit",
  "vite",
  "html",
  "unknown",
];

describe("stack guide (TEST-3501)", () => {
  it("every framework has a location + placement + non-empty notes", () => {
    for (const fw of FRAMEWORKS) {
      const g = getStackGuide(fw);
      expect(g.framework).toBe(fw);
      expect(g.location.length).toBeGreaterThan(0);
      expect(g.placement.length).toBeGreaterThan(0);
      expect(g.notes.length).toBeGreaterThan(0);
    }
  });

  it("notes cover SPA/History and the group parameter (loading contract)", () => {
    const text = STACK_GUIDES["next-app"].notes.join("\n").toLowerCase();
    expect(text).toContain("history");
    expect(text).toContain("group");
  });

  it("getStackGuide falls back to unknown for an unexpected value", () => {
    expect(getStackGuide("nope" as Framework).framework).toBe("unknown");
  });
});

describe("CMS plugin guide (TEST-3502)", () => {
  it("points at the official plugin + account_id, never PHP edits", () => {
    const g = getPlatformPluginGuide("woocommerce", "acc-1");
    expect(g).toContain("WooCommerce");
    expect(g).toContain("acc-1");
    expect(g.toLowerCase()).toContain("do not edit");
  });
});
