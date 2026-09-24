/**
 * What `verify_event_instrumented` expects from the production row (PRD-058 F4).
 * Seeing an event with the right name in the last seconds proves little on a site
 * with traffic, and nothing about its revenue or properties. An expectation — from
 * the agent, or derived from the simulation of the same plan — turns "a row arrived"
 * into "the row the install was supposed to send arrived".
 *
 * Rows come from GET /stats/{conversions,microconversions}/raw: `amount` is a
 * Decimal serialised as a string, `properties` a map of strings.
 */
import type { StoredEvent } from "./simulate/mirror.js";

export interface EventExpectation {
  /** The row must carry at least this revenue (e.g. 0.01: "any revenue at all"). */
  value_min?: number;
  /** Only a row with exactly this amount counts: a test order with a recognisable total. */
  value_exact?: number;
  /** Property keys the row must carry. */
  properties_required?: string[];
}

export interface RawEventRow {
  conversion_type?: unknown;
  amount?: unknown;
  properties?: unknown;
  timestamp_utc?: unknown;
}

const CENT = 0.005;

export const rowAmount = (row: RawEventRow): number | null => {
  if (row.amount === undefined || row.amount === null || row.amount === "") return null;
  const n = Number(row.amount);
  return Number.isFinite(n) ? n : null;
};

/** `properties` as an object, whether the API sent a map or a JSON string. */
export function rowProperties(row: RawEventRow): Record<string, unknown> {
  const p = row.properties;
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  if (typeof p === "string") {
    try {
      const parsed = JSON.parse(p);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Rows of this event name at or after `sinceMs` (minus a small clock tolerance).
 * `timestamp_utc` is the browser's clock when the event fired, so callers pass a
 * lookback window, not the moment polling started.
 */
export function recentRowsFor(rows: RawEventRow[], name: string, sinceMs: number, toleranceMs = 5_000): RawEventRow[] {
  return rows.filter((row) => {
    if (String(row.conversion_type ?? "") !== name) return false;
    const ts = Date.parse(String(row.timestamp_utc ?? ""));
    return Number.isFinite(ts) && ts >= sinceMs - toleranceMs;
  });
}

/**
 * With `value_exact`, only the row carrying that amount is the test event. Otherwise
 * the newest row that meets the expectation, so a real visitor's older-code row does
 * not hide the test; the newest row when none does (and it is then a mismatch).
 */
export function pickRow(rows: RawEventRow[], expect: EventExpectation | undefined): RawEventRow | undefined {
  if (expect?.value_exact !== undefined) {
    return rows.find((row) => {
      const amount = rowAmount(row);
      return amount !== null && Math.abs(amount - expect.value_exact!) < CENT;
    });
  }
  return rows.find((row) => compareRow(row, expect).length === 0) ?? rows[0];
}

/** Differences between the production row and what was expected, one sentence each. */
export function compareRow(row: RawEventRow, expect: EventExpectation | undefined): string[] {
  if (!expect) return [];
  const mismatches: string[] = [];
  const amount = rowAmount(row);
  if (expect.value_min !== undefined && (amount === null || amount < expect.value_min)) {
    mismatches.push(
      amount === null || amount === 0
        ? `The row carries no revenue (amount ${amount ?? "missing"}), expected at least ${expect.value_min}. The call most likely sent a string instead of a number.`
        : `The row carries amount ${amount}, expected at least ${expect.value_min}.`,
    );
  }
  if (expect.value_exact !== undefined && (amount === null || Math.abs(amount - expect.value_exact) >= CENT)) {
    mismatches.push(`The row carries amount ${amount ?? "missing"}, expected exactly ${expect.value_exact}.`);
  }
  const props = rowProperties(row);
  const missing = (expect.properties_required ?? []).filter((k) => !(k in props));
  if (missing.length) mismatches.push(`Properties missing from the row: ${missing.join(", ")}.`);
  return mismatches;
}

/**
 * The expectation a simulation implies for one event: revenue if the simulated hit
 * stored some or the plan declares a value for it (a synthetic case without a value
 * example simulates amount 0), and every property key it stored.
 */
export function expectationFromStored(stored: StoredEvent, planDeclaresRevenue = false): EventExpectation {
  const expect: EventExpectation = {};
  if (stored.event_type === "conversion" && (stored.amount > 0 || planDeclaresRevenue)) expect.value_min = 0.01;
  const keys = Object.keys(stored.properties);
  if (keys.length) expect.properties_required = keys;
  return expect;
}

/** Explicit fields win over the simulation's; property lists are merged. */
export function mergeExpectations(fromSimulation: EventExpectation | undefined, explicit: EventExpectation | undefined): EventExpectation | undefined {
  if (!fromSimulation && !explicit) return undefined;
  const props = [...new Set([...(fromSimulation?.properties_required ?? []), ...(explicit?.properties_required ?? [])])];
  const merged: EventExpectation = { ...fromSimulation, ...explicit };
  if (props.length) merged.properties_required = props;
  return merged;
}
