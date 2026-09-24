import { describe, it, expect } from "vitest";
import {
  compareRow,
  expectationFromStored,
  mergeExpectations,
  pickRow,
  recentRowsFor,
  rowProperties,
} from "../src/verify-expect.js";

const T0 = Date.parse("2026-09-14T10:00:00Z");
const row = (over: Record<string, unknown>) => ({
  conversion_type: "purchase",
  amount: "149.99",
  properties: { currency: "EUR", items: '[{"product_id":"SKU-1"}]' },
  timestamp_utc: new Date(T0 + 2_000).toISOString(),
  ...over,
});

describe("verification expectations (PRD-058 F4)", () => {
  it("filters rows by event name and recency, not just recency", () => {
    const rows = [row({ conversion_type: "add_to_cart" }), row({ timestamp_utc: new Date(T0 - 60_000).toISOString() }), row({})];
    expect(recentRowsFor(rows, "purchase", T0)).toHaveLength(1);
  });

  it("value_exact picks the test order among other recent purchases", () => {
    const rows = [row({ amount: "89.00" }), row({ amount: "1.23" })];
    expect(pickRow(rows, { value_exact: 1.23 })?.amount).toBe("1.23");
    expect(pickRow(rows, { value_exact: 5 })).toBeUndefined();
    expect(pickRow(rows, undefined)?.amount).toBe("89.00");
  });

  it("without value_exact, prefers the newest row that meets the expectation", () => {
    const rows = [row({ amount: "0.00" }), row({ amount: "12.00" })];
    expect(pickRow(rows, { value_min: 0.01 })?.amount).toBe("12.00");
    expect(pickRow([row({ amount: "0.00" })], { value_min: 0.01 })?.amount).toBe("0.00");
  });

  it("reports revenue 0 as the string-amount bug, and missing properties", () => {
    const m = compareRow(row({ amount: "0.00", properties: { currency: "EUR" } }), { value_min: 0.01, properties_required: ["currency", "items"] });
    expect(m[0]).toMatch(/no revenue.*string instead of a number/);
    expect(m[1]).toBe("Properties missing from the row: items.");
    expect(compareRow(row({}), { value_min: 0.01, properties_required: ["currency", "items"] })).toEqual([]);
  });

  it("reads properties sent as a JSON string", () => {
    expect(rowProperties({ properties: '{"a":"1"}' })).toEqual({ a: "1" });
    expect(rowProperties({ properties: "not json" })).toEqual({});
  });

  it("derives an expectation from a simulated hit and lets explicit fields win", () => {
    const fromSim = expectationFromStored({ event_type: "conversion", conversion_type: "purchase", amount: 149.99, is_micro: false, content_grouping: "", properties: { currency: "EUR", items: "[]" } });
    expect(fromSim).toEqual({ value_min: 0.01, properties_required: ["currency", "items"] });
    expect(mergeExpectations(fromSim, { value_exact: 1.23, properties_required: ["coupon"] })).toEqual({
      value_min: 0.01,
      value_exact: 1.23,
      properties_required: ["currency", "items", "coupon"],
    });
    expect(mergeExpectations(undefined, undefined)).toBeUndefined();
    const zero = { event_type: "conversion", conversion_type: "purchase", amount: 0, is_micro: false, content_grouping: "", properties: {} } as const;
    expect(expectationFromStored(zero)).toEqual({});
    expect(expectationFromStored(zero, true)).toEqual({ value_min: 0.01 });
  });
});
