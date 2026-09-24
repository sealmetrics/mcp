import type { InstallPlanInput } from "../../src/plan/types.js";

/** A clean ecommerce plan: plan_install returns no block findings for it. */
export function ecommercePlan(overrides: Partial<InstallPlanInput> = {}): InstallPlanInput {
  return {
    account_id: "acct_demo",
    vertical: "ecommerce",
    site: { domain: "demo-store.com", framework: "next-app" },
    loader: { file: "app/layout.tsx", snippet_url: "https://t.sealmetrics.com/t.js?id=acct_demo" },
    events: [
      {
        kind: "micro",
        name: "view_item",
        trigger: { type: "page", where: "app/products/[slug]/page.tsx" },
        properties: {
          product_id: { source: "product.id", type: "string", example: "SKU-123" },
          price: { source: "product.price", type: "number", example: 19.9 },
        },
      },
      {
        kind: "micro",
        name: "add_to_cart",
        trigger: { type: "click", where: "components/AddToCart.tsx" },
        properties: {
          product_id: { source: "product.id", type: "string", example: "SKU-123" },
          quantity: { type: "number", example: 1 },
        },
      },
      {
        kind: "micro",
        name: "begin_checkout",
        trigger: { type: "page", where: "app/checkout/page.tsx" },
        properties: { items_count: { type: "number", example: 2 } },
      },
      {
        kind: "conv",
        name: "purchase",
        trigger: { type: "page", where: "app/checkout/success/page.tsx" },
        value: { source: "order.total", type: "number", example: 149.99 },
        properties: {
          currency: { source: "order.currency", type: "string", example: "EUR" },
          items: {
            type: "list",
            max_items: 3,
            item: { product_id: "string", quantity: "number", price: "number" },
          },
        },
      },
    ],
    product_identifier: { key: "product_id", applies_to: ["view_item", "add_to_cart", "purchase.items"] },
    ...overrides,
  };
}

export const DOMAINS = ["demo-store.com"];
