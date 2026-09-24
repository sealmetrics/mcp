/**
 * Custom date ranges (start_date/end_date) on every stats tool — the MCP
 * counterpart of the API's explicit-dates support (account-local days).
 *
 *  - TEST-CDR01: every tool that exposes `period` also exposes
 *    `start_date`/`end_date` (sweep guard for future tools).
 *  - TEST-CDR02: `dateRangeParams` semantics — custom dates OMIT `period`
 *    (the API gives period precedence, and the client-side "30d" default
 *    would silently override the range otherwise), one-sided/invalid ranges
 *    are rejected with clear errors, presets pass through untouched.
 *  - TEST-CDR03: handlers actually forward the dates (and drop period).
 */
import { describe, it, expect } from "vitest";
import { ALL_TOOLS } from "../src/tools/index.js";
import { dateRangeParams } from "../src/tools/shared.js";

type SchemaProps = Record<string, unknown> | undefined;

function props(tool: (typeof ALL_TOOLS)[number]): SchemaProps {
  return (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
}

describe("TEST-CDR01: schema coverage", () => {
  it("every tool with `period` also exposes start_date and end_date", () => {
    const missing = ALL_TOOLS.filter((t) => {
      const p = props(t);
      return p?.period && (!p.start_date || !p.end_date);
    }).map((t) => t.name);
    expect(missing, `tools missing custom-range params: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("TEST-CDR02: dateRangeParams semantics", () => {
  it("defaults to 30d when nothing is provided", () => {
    expect(dateRangeParams({})).toEqual({ period: "30d" });
  });

  it("passes a preset through untouched", () => {
    expect(dateRangeParams({ period: "mtd" })).toEqual({ period: "mtd" });
  });

  it("a custom range omits period entirely (dates win over the client-side default)", () => {
    expect(
      dateRangeParams({ period: "30d", start_date: "2026-07-01", end_date: "2026-07-07" }),
    ).toEqual({ start_date: "2026-07-01", end_date: "2026-07-07" });
  });

  it("rejects one-sided ranges", () => {
    expect(() => dateRangeParams({ start_date: "2026-07-01" })).toThrow(/together/);
    expect(() => dateRangeParams({ end_date: "2026-07-07" })).toThrow(/together/);
  });

  it("rejects non-ISO formats", () => {
    expect(() => dateRangeParams({ start_date: "01/07/2026", end_date: "2026-07-07" })).toThrow(
      /YYYY-MM-DD/,
    );
  });

  it("rejects inverted ranges", () => {
    expect(() => dateRangeParams({ start_date: "2026-07-08", end_date: "2026-07-07" })).toThrow(
      /on or before/,
    );
  });
});

describe("TEST-CDR03: handlers forward custom dates", () => {
  function capturingClient() {
    const captured: { path?: string; params?: Record<string, unknown> } = {};
    const client = {
      request: async (path: string, params: Record<string, unknown>) => {
        captured.path = path;
        captured.params = params;
        return {};
      },
      requestPaginated: async (path: string, params: Record<string, unknown>) => {
        captured.path = path;
        captured.params = params;
        return { items: [] };
      },
    };
    return { captured, client };
  }

  it.each(["get_overview", "get_traffic_sources", "get_top_channels", "get_conversions"])(
    "%s sends start_date/end_date and no period",
    async (name) => {
      const tool = ALL_TOOLS.find((t) => t.name === name);
      expect(tool).toBeDefined();
      const { captured, client } = capturingClient();
      await tool!.handler(client as never, {
        site_id: "site-1",
        start_date: "2026-07-01",
        end_date: "2026-07-07",
      });
      expect(captured.params).toMatchObject({
        start_date: "2026-07-01",
        end_date: "2026-07-07",
      });
      expect(captured.params?.period).toBeUndefined();
    },
  );

  it("get_overview still defaults to period=30d without dates", async () => {
    const tool = ALL_TOOLS.find((t) => t.name === "get_overview")!;
    const { captured, client } = capturingClient();
    await tool.handler(client as never, { site_id: "site-1" });
    expect(captured.params?.period).toBe("30d");
    expect(captured.params?.start_date).toBeUndefined();
  });
});
