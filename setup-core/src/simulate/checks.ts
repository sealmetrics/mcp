/**
 * Checks on one captured hit against its planned event (PRD-058): what both the
 * call-level sandbox and the page-level browser simulation judge once a hit exists.
 * SM-03 name and kind · SM-04 revenue · SM-05 properties · SM-06 PII · SM-07 size ·
 * SM-08 mirror rejection · SM-11 what is stored.
 */
import { detectPIIDeep } from "../instrument.js";
import { EVENT_BODY_WARN_BYTES } from "../plan/size.js";
import type { NormalizedEvent } from "../plan/types.js";
import { MAX_EVENT_BODY_BYTES, type MirrorResult } from "./mirror.js";

export type CheckOutcome = "pass" | "fail" | "warn" | "info";

export interface SimCheck {
  code: string;
  result: CheckOutcome;
  message: string;
  fix?: string;
}

export function describeValue(arg: { type: string; value?: unknown } | undefined): string {
  if (!arg) return "no argument";
  return arg.type === "string" ? `string '${String(arg.value)}'` : arg.value !== undefined ? `${arg.type} ${String(arg.value)}` : arg.type;
}

/** `amountArg`: the recorded second argument of conv(), when the caller saw the call. */
export function checkPayload(
  planned: NormalizedEvent,
  first: MirrorResult,
  amountArg?: { type: string; value?: unknown },
): SimCheck[] {
  const checks: SimCheck[] = [];
  const payload = first.payload ?? {};


  // SM-08 — rejected by the mirror.
  if (first.rejection) {
    checks.push({ code: "SM-08", result: "fail", message: `pixel-service would reject this hit as ${first.rejection} and answer 204: ${first.detail ?? ""}` });
  }

  // SM-03 — event name and kind.
  if (planned.kind === "pageview") {
    if (planned.group && payload.g !== planned.group) {
      checks.push({ code: "SM-03", result: "fail", message: `The pageview carries group '${String(payload.g ?? "")}', the plan says '${planned.group}'.` });
    }
  } else {
    const isMicro = first.stored_as?.is_micro ?? Boolean(payload.m);
    if (payload.e !== planned.name || isMicro !== (planned.kind === "micro")) {
      checks.push({
        code: "SM-03",
        result: "fail",
        message: `The hit is ${isMicro ? "micro" : "conv"} '${String(payload.e)}', the plan says ${planned.kind} '${planned.name}'.`,
      });
    } else {
      checks.push({ code: "SM-03", result: "pass", message: `${planned.kind} '${planned.name}' as planned.` });
    }
  }

  // SM-04 — revenue.
  if (planned.kind === "conv" && planned.value) {
    const expected = typeof planned.value.example === "number" ? planned.value.example : null;
    const stored = first.stored_as?.amount ?? (typeof payload.v === "number" ? payload.v : 0);
    if (payload.v === undefined) {
      checks.push({
        code: "SM-04",
        result: "fail",
        message: amountArg
          ? `amount must be a number: got ${describeValue(amountArg)}. The conversion would be stored with revenue 0.`
          : "The conversion was sent without an amount (not a number where the call was made). It would be stored with revenue 0.",
        fix: `sealmetrics.conv('${planned.name}', Number(${planned.value.source ?? "total"}), …)`,
      });
    } else if (stored === 0 && expected !== null && expected !== 0) {
      checks.push({ code: "SM-04", result: "fail", message: "The conversion carries amount 0 where the plan expects revenue." });
    } else {
      checks.push({ code: "SM-04", result: "pass", message: `Amount ${stored} stored.` });
    }
  }

  // SM-05 — planned properties present.
  if (planned.kind !== "pageview") {
    const x = (payload.x && typeof payload.x === "object" ? payload.x : {}) as Record<string, unknown>;
    const missing = Object.keys(planned.properties).filter((k) => !(k in x));
    const extra = Object.keys(x).filter((k) => !(k in planned.properties));
    if (missing.length) {
      checks.push({ code: "SM-05", result: "fail", message: `Planned properties missing: ${missing.join(", ")}.` });
    }
    for (const [key, spec] of Object.entries(planned.properties)) {
      if (!spec.item || !Array.isArray(x[key])) continue;
      const items = x[key] as Record<string, unknown>[];
      const lacking = Object.keys(spec.item).filter((ik) => items.some((it) => !it || typeof it !== "object" || !(ik in it)));
      if (lacking.length) checks.push({ code: "SM-05", result: "fail", message: `Items of '${key}' lack: ${lacking.join(", ")}.` });
    }
    if (extra.length) {
      checks.push({ code: "SM-05", result: "warn", message: `Properties sent but not in the plan: ${extra.join(", ")}. The approval did not cover them.` });
    }
    if (!missing.length && !extra.length) checks.push({ code: "SM-05", result: "pass", message: "Properties match the plan." });

    // SM-06 — PII in what is actually sent.
    const pii = detectPIIDeep(x);
    if (pii.length) {
      checks.push({
        code: "SM-06",
        result: "fail",
        message: `The payload carries likely personal data: ${pii.map((f) => `${f.key} (${f.reason})`).join(", ")}.`,
        fix: "Remove it before deploying; once stored it cannot be taken back.",
      });
    }

    // SM-11 — what the server stores.
    const converted = Object.entries(x).filter(([, v]) => typeof v !== "string").map(([k]) => k);
    if (converted.length && first.stored_as) {
      checks.push({
        code: "SM-11",
        result: "info",
        message: `Stored as strings: ${converted.map((k) => `${k} → ${JSON.stringify(first.stored_as!.properties[k]).slice(0, 80)}`).join("; ")}.`,
      });
    }
  }

  // SM-07 — body size.
  if (first.body_bytes > MAX_EVENT_BODY_BYTES) {
    checks.push({ code: "SM-07", result: "fail", message: `Body is ${first.body_bytes} bytes; pixel-service reads ${MAX_EVENT_BODY_BYTES} and rejects the truncated JSON.` });
  } else if (first.body_bytes > EVENT_BODY_WARN_BYTES) {
    checks.push({ code: "SM-07", result: "warn", message: `Body is ${first.body_bytes} bytes, ${MAX_EVENT_BODY_BYTES - first.body_bytes} under the limit.` });
  }

  return checks;
}
