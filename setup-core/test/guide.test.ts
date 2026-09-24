import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { INSTRUMENTATION_GUIDE, getInstrumentationGuide, buildInstrumentationMarkdown } from "../src/guide.js";

const here = dirname(fileURLToPath(import.meta.url));
const canonical = join(here, "..", "..", "integrations", "prompts", "sealmetrics-implementation-prompt.md");

describe("instrumentation guide (VAL-3101)", () => {
  it("generated guide is in sync with the canonical asset (single source)", () => {
    const source = readFileSync(canonical, "utf8");
    expect(INSTRUMENTATION_GUIDE).toBe(source);
  });

  it("getInstrumentationGuide aliases buildInstrumentationMarkdown (RF-3101)", () => {
    expect(getInstrumentationGuide).toBe(buildInstrumentationMarkdown);
  });

  it("substitutes the account_id and hoists privacy", () => {
    const md = getInstrumentationGuide("acc-xyz");
    expect(md).toContain("acc-xyz");
    expect(md).not.toContain("[YOUR_ACCOUNT_ID]");
    expect(md).toMatch(/PRIVACY/i);
    expect(md.toLowerCase()).toContain("never");
  });
});
