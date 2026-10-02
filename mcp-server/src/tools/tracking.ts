import type { SealMetricsClient } from "../client.js";
import { resolveSiteId, SITE_ID_SCHEMA } from "./shared.js";
import type { ToolDef } from "./index.js";

/** Response shape from GET /sites/{id}/pixel */
interface PixelCodeResponse {
  account_id: string;
  site_id: string;
  script_tag: string;
  tracker_url: string;
  instructions: string;
}

const JS_API_REFERENCE = {
  pageview: {
    description: "Tracked automatically on load and SPA navigation. Manual call rarely needed.",
    signatures: [
      { call: "sealmetrics()", description: "Manual pageview" },
      {
        call: "sealmetrics({ group: 'blog' })",
        description: "Pageview with content grouping",
      },
    ],
  },
  conversion: {
    description:
      "Track conversions with monetary value. Use for purchases, signups, leads.",
    signatures: [
      {
        call: "sealmetrics.conv('purchase', 99.99)",
        description: "Basic conversion",
      },
      {
        call: "sealmetrics.conv('purchase', 149.99, { currency: 'EUR' })",
        description: "Conversion with properties",
      },
      {
        call: "sealmetrics.conv('lead', 0, { source: 'contact_form' })",
        description: "Lead without monetary value",
      },
    ],
  },
  microconversion: {
    description:
      "Track funnel steps and engagement events. Use for add_to_cart, scroll milestones, video plays, newsletter signups.",
    signatures: [
      {
        call: "sealmetrics.micro('add_to_cart')",
        description: "Basic microconversion",
      },
      {
        call: "sealmetrics.micro('add_to_cart', { product_id: 'SKU-123', price: 49.99 })",
        description: "Microconversion with properties",
      },
    ],
  },
};

const IMPLEMENTATION_GUIDE = {
  installation: [
    "Add the <script> tag in the <head> of every page, before </head>.",
    "Use the 'defer' attribute — the script loads async and never blocks rendering.",
    "Pageviews are tracked automatically on load and SPA navigation (pushState, replaceState, popstate).",
    "No cookies, no localStorage, no consent banner needed (GDPR-friendly).",
  ],
  content_grouping: {
    description:
      "Categorize pages into sections for better analysis. Add via URL param or JS call.",
    via_url_param: '<script src="https://t.sealmetrics.com/t.js?id=SITE_ID&group=blog" defer></script>',
    via_js: "sealmetrics({ group: 'blog' })",
    recommended_groups: [
      "blog",
      "product",
      "category",
      "checkout",
      "docs",
      "app",
      "landing",
      "support",
    ],
  },
  naming_conventions: [
    "Use snake_case for conversion and microconversion types: 'add_to_cart', not 'addToCart'.",
    "Use descriptive names: 'begin_checkout', not 'step2'.",
    "Do NOT include order IDs or user IDs in the type name — use properties instead.",
    "Keep types stable — changing names breaks historical data continuity.",
  ],
  spa_support:
    "Automatic. Works with React Router, Vue Router, Next.js, Nuxt, Angular, and any History API-based routing. No extra config.",
  debugging:
    "Add ?debug=1 to any page URL to enable console logging of all tracking events.",
};

const EXAMPLES = {
  ecommerce: {
    description: "E-commerce site with product pages, cart, and checkout",
    code: `<!-- In <head> of all pages -->
<script src="https://t.sealmetrics.com/t.js?id=SITE_ID&group=product" defer></script>

<script>
// Add to cart button
document.querySelector('.add-to-cart').addEventListener('click', function() {
  sealmetrics.micro('add_to_cart', {
    product_id: this.dataset.productId,
    price: parseFloat(this.dataset.price)
  });
});

// Begin checkout
document.querySelector('.checkout-btn').addEventListener('click', function() {
  sealmetrics.micro('begin_checkout', { cart_value: getCartTotal() });
});
</script>

<!-- On thank-you page (group=checkout) -->
<script src="https://t.sealmetrics.com/t.js?id=SITE_ID&group=checkout" defer></script>
<script>
sealmetrics.conv('purchase', 189.99, {
  currency: 'EUR',
  payment_method: 'credit_card'
});
</script>`,
  },
  saas: {
    description: "SaaS / lead generation site",
    code: `<!-- In <head> -->
<script src="https://t.sealmetrics.com/t.js?id=SITE_ID&group=marketing" defer></script>

<script>
// Demo request form
document.querySelector('#demo-form').addEventListener('submit', function() {
  sealmetrics.conv('lead', 0, { form_name: 'demo_request' });
});

// Newsletter signup
document.querySelector('#newsletter').addEventListener('submit', function() {
  sealmetrics.micro('newsletter_signup', { position: 'footer' });
});
</script>

<!-- On signup success page -->
<script>
sealmetrics.conv('signup', 0, { plan: 'trial' });
</script>

<!-- On upgrade/payment -->
<script>
sealmetrics.conv('purchase', 49, { plan: 'pro_monthly', currency: 'USD' });
</script>`,
  },
  blog_media: {
    description: "Blog or media site with content engagement tracking",
    code: `<!-- In <head> -->
<script src="https://t.sealmetrics.com/t.js?id=SITE_ID&group=blog" defer></script>

<script>
// Video engagement
document.querySelector('video')?.addEventListener('play', function() {
  sealmetrics.micro('video_play', { video_id: this.dataset.videoId });
});
document.querySelector('video')?.addEventListener('ended', function() {
  sealmetrics.micro('video_complete', { video_id: this.dataset.videoId });
});

// Scroll depth milestones
var tracked = {};
window.addEventListener('scroll', function() {
  var pct = Math.round(window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100);
  [25, 50, 75, 100].forEach(function(m) {
    if (pct >= m && !tracked[m]) {
      tracked[m] = true;
      sealmetrics.micro('scroll_' + m);
    }
  });
});
</script>`,
  },
  react_nextjs: {
    description: "React / Next.js application",
    code: `// In layout.tsx or _app.tsx — add the script tag
import Script from 'next/script';

export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        <Script
          src="https://t.sealmetrics.com/t.js?id=SITE_ID"
          strategy="afterInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

// In any component — track conversions/microconversions
function CheckoutButton({ total, currency }) {
  const handlePurchase = () => {
    window.sealmetrics?.conv('purchase', total, { currency });
  };
  return <button onClick={handlePurchase}>Complete Purchase</button>;
}

// Track microconversions
function AddToCartButton({ productId, price }) {
  const handleClick = () => {
    window.sealmetrics?.micro('add_to_cart', { product_id: productId, price });
  };
  return <button onClick={handleClick}>Add to Cart</button>;
}`,
  },
};

export const getTrackingCodeTool: ToolDef = {
  name: "get_tracking_code",
  description:
    "Get the tracking pixel code for a site and the full JavaScript API reference for implementing pageviews, conversions, microconversions, and content grouping. Returns the site-specific <script> tag plus implementation guide with examples for e-commerce, SaaS, blog, and React/Next.js.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
    },
  },
  handler: async (
    client: SealMetricsClient,
    args: Record<string, unknown>,
  ) => {
    const siteId = resolveSiteId(args);
    const pixel = await client.request<PixelCodeResponse>(
      `/sites/${encodeURIComponent(siteId)}/pixel`,
    );

    return {
      site_id: pixel.site_id ?? pixel.account_id,
      script_tag: pixel.script_tag,
      tracker_url: pixel.tracker_url,
      js_api: JS_API_REFERENCE,
      implementation_guide: IMPLEMENTATION_GUIDE,
      examples: EXAMPLES,
    };
  },
};
