/**
 * Contract test, TypeScript side (PRD-058 E2). The same fixtures run through the Go
 * ingestion code in pixel-service/internal/handler/mirror_contract_test.go. If the
 * server changes how it parses, rejects or stores a hit, one of the two fails.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mirrorEvent } from "../src/simulate/mirror.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "..", "fixtures", "sim-contract");

interface Fixture {
  description: string;
  account_ids: string[];
  domains: string[];
  content_type?: string;
  body: string;
  expect: { rejection: string; stored_as?: Record<string, unknown> };
}

const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ name: f, fx: JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture }));

describe("mirror matches the sim-contract fixtures", () => {
  it("has fixtures to run", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const { name, fx } of fixtures) {
    it(`${name}: ${fx.description}`, () => {
      const r = mirrorEvent({ body: fx.body, contentType: fx.content_type, accountIds: fx.account_ids, domains: fx.domains });
      expect(r.rejection ?? "").toBe(fx.expect.rejection);
      if (fx.expect.stored_as) expect(r.stored_as).toEqual(fx.expect.stored_as);
    });
  }
});
