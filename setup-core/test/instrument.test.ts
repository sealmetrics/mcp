import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CONV_TYPES,
  MICRO_TYPES,
  validateEventName,
  detectPII,
  detectPIIDeep,
  checkInstrumentation,
} from "../src/instrument.js";

const here = dirname(fileURLToPath(import.meta.url));
const canonical = join(here, "..", "..", "integrations", "prompts", "sealmetrics-implementation-prompt.md");

describe("taxonomy (VAL-3401)", () => {
  it("accepts in-taxonomy conv/micro names", () => {
    expect(validateEventName("conv", "purchase").valid).toBe(true);
    expect(validateEventName("micro", "add_to_cart").valid).toBe(true);
  });

  it("flags out-of-taxonomy names with a suggestion (not silent)", () => {
    const r = validateEventName("conv", "purchases");
    expect(r.valid).toBe(false);
    expect(r.suggestion).toBe("purchase");
  });

  it("every taxonomy name actually appears in the canonical asset (single source, no drift)", () => {
    const asset = readFileSync(canonical, "utf8");
    // Names appear either in the backtick reference list or in `'single-quoted'`
    // code examples — assert presence in any form so the guide and the closed
    // taxonomy never drift apart (audit HIGH-2).
    for (const t of [...CONV_TYPES, ...MICRO_TYPES]) {
      expect(asset.includes(t)).toBe(true);
    }
  });
});

describe("PII gate (VAL-3402)", () => {
  it("flags forbidden keys: order_id, email, customer_id", () => {
    const findings = detectPII({ order_id: "123", value: 10 });
    expect(findings.some((f) => f.key === "order_id" && f.reason === "forbidden_key")).toBe(true);

    expect(detectPII({ email: "x" }).length).toBe(1);
    expect(detectPII({ customerId: "u-1" }).length).toBe(1);
    expect(detectPII({ user_id: "u-1" }).length).toBe(1);
    expect(detectPII({ transaction_number: "T-9" }).length).toBe(1);
  });

  it("flags email/phone-looking VALUES under innocent keys", () => {
    expect(detectPII({ note: "reach me at a@b.com" })[0]?.reason).toBe("email_value");
    expect(detectPII({ contact: "+1 415 555 0132" })[0]?.reason).toBe("phone_value");
  });

  it("passes clean, allowed properties", () => {
    expect(detectPII({ product: "Blue Shirt", category: "apparel", currency: "EUR", quantity: 2 })).toHaveLength(0);
  });

  it("does NOT flag guide-canonical, non-PII keys (audit HIGH-1 regression)", () => {
    for (const key of [
      "product_name",
      "form_name",
      "file_name",
      "video_id",
      "order_total",
      "order_status",
      "order_date",
      "transaction_amount",
      "plan",
      "feature",
      "query",
    ]) {
      expect(detectPII({ [key]: "x" })).toHaveLength(0);
    }
  });

  it("article_read and feature_use are valid micro names (no rejection)", () => {
    expect(validateEventName("micro", "article_read").valid).toBe(true);
    expect(validateEventName("micro", "feature_use").valid).toBe(true);
  });

  it("checkInstrumentation: clean purchase ok; PII or bad name not ok", () => {
    expect(checkInstrumentation("conv", "purchase", { product: "Shirt", currency: "EUR" }).ok).toBe(true);
    expect(checkInstrumentation("conv", "purchase", { order_id: "1" }).ok).toBe(false);
    expect(checkInstrumentation("conv", "buy_now", { product: "Shirt" }).ok).toBe(false);
  });
});

describe("deep PII scan (PRD-058 A3)", () => {
  it("finds a forbidden key inside items[] that the top-level scan misses", () => {
    const props = { currency: "EUR", items: [{ product_id: "SKU-1", order_id: "A-77" }] };
    expect(detectPII(props)).toHaveLength(0);
    expect(detectPIIDeep(props)).toEqual([{ key: "items[0].order_id", reason: "forbidden_key" }]);
  });

  it("parses a JSON string the way FlexStringMap stores items", () => {
    const stored = { items: JSON.stringify([{ sku: "S", note: "ping a@b.com" }]) };
    expect(detectPIIDeep(stored)).toEqual([{ key: "items[0].note", reason: "email_value" }]);
  });

  it("passes clean nested ecommerce payloads", () => {
    expect(detectPIIDeep({ items: [{ product_id: "123", price: 9.9, quantity: 2, category: "x" }] })).toHaveLength(0);
  });

  it("does not report an EAN or numeric SKU as a phone, at any depth", () => {
    expect(detectPII({ product_id: "8412345678905" })).toHaveLength(0);
    expect(detectPIIDeep({ items: [{ sku: "8412345678905", ean: "8412345678905" }] })).toHaveLength(0);
    // …but the same digits under an innocent key, or a bare `id`, are still a phone.
    expect(detectPII({ id: "8412345678905" })[0]?.reason).toBe("phone_value");
    expect(detectPIIDeep({ contact: "8412345678905" })[0]?.reason).toBe("phone_value");
  });
});
