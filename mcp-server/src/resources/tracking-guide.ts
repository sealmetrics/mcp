/**
 * Static tracking guide exposed as an MCP resource.
 * Claude reads this on connect and knows how to implement SealMetrics tracking
 * without calling any tool.
 *
 * This is an operational playbook, not just an API reference.
 * It tells the agent WHAT to do, HOW to decide, and WHERE to put things.
 */
export const TRACKING_GUIDE_URI = "sealmetrics://tracking-guide";
export const TRACKING_GUIDE_NAME = "SealMetrics Tracking Guide";
export const TRACKING_GUIDE_DESCRIPTION =
  "Operational playbook for implementing SealMetrics tracking on any website: pixel installation, conversions, microconversions, content grouping, and framework-specific patterns.";

export const TRACKING_GUIDE_CONTENT = `# SealMetrics Tracking — Implementation Playbook

You are implementing SealMetrics analytics on a website. This guide tells you exactly what to do, step by step.

---

## Step 1: Get the pixel

Call the \`get_tracking_code\` tool with the user's \`site_id\`. It returns:
- \`script_tag\`: the exact \`<script>\` tag to insert (with the real site ID baked in)
- \`tracker_url\`: the URL of the tracker JS file

If you don't know the site_id, call \`list_sites\` first to find it.

---

## Step 2: Find where to insert the script

The script tag goes in the \`<head>\` of every page, **once**. Where that is depends on the framework:

| Framework | Where to put it |
|-----------|----------------|
| **Plain HTML** | Inside \`<head>\` in every \`.html\` file, or in a shared template/layout |
| **Next.js (App Router)** | \`app/layout.tsx\` — use \`import Script from 'next/script'\` with \`strategy="afterInteractive"\` |
| **Next.js (Pages Router)** | \`pages/_app.tsx\` — use \`<Script>\` component |
| **React (CRA/Vite)** | \`index.html\` inside \`<head>\` |
| **Vue / Nuxt** | \`nuxt.config.ts\` head section, or \`app.vue\` |
| **Angular** | \`src/index.html\` inside \`<head>\` |
| **Astro** | Shared layout component \`<head>\` |
| **WordPress** | \`header.php\` or via a "header scripts" plugin/setting |
| **Shopify** | \`theme.liquid\` inside \`<head>\` |

**How to find it**: Search for \`</head>\`, or look for the root layout/template file. Every framework has one place that wraps all pages — that's where the script goes.

### Plain HTML
\`\`\`html
<head>
  <!-- other tags... -->
  <script src="https://t.sealmetrics.com/t.js?id=SITE_ID" defer></script>
</head>
\`\`\`

### Next.js (App Router)
\`\`\`tsx
// app/layout.tsx
import Script from 'next/script';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body>
        {children}
        <Script src="https://t.sealmetrics.com/t.js?id=SITE_ID" strategy="afterInteractive" />
      </body>
    </html>
  );
}
\`\`\`

### Vue / Nuxt
\`\`\`ts
// nuxt.config.ts
export default defineNuxtConfig({
  app: {
    head: {
      script: [{ src: 'https://t.sealmetrics.com/t.js?id=SITE_ID', defer: true }]
    }
  }
});
\`\`\`

**Once the script is in place, pageviews are tracked automatically** — on load, on SPA navigation (pushState, replaceState, popstate), on back/forward. You do NOT need to add manual pageview calls.

---

## Step 3: Identify what to track

Analyze the website code and identify trackeable user actions. Classify each one as a **conversion** or a **microconversion**.

### What is a conversion?

A conversion is a **business goal** — the main thing the site owner wants users to do. It typically has monetary value or represents a completed transaction.

| What you see in the code | Conversion type | Has value? |
|--------------------------|-----------------|------------|
| Purchase/checkout completion, order confirmation page | \`purchase\` | Yes — the order total |
| Subscription payment, plan upgrade | \`purchase\` | Yes — the subscription price |
| Contact form, demo request, quote request | \`lead\` | No (use \`0\`) |
| Account registration, signup form | \`signup\` | No (use \`0\`) |
| Booking confirmation, appointment scheduled | \`booking\` | Yes if there's a price, otherwise \`0\` |

**Rule of thumb**: If the business would pay money to make this action happen, it's a conversion.

### What is a microconversion?

A microconversion is a **step toward a conversion** or an **engagement signal**. It tells you how users interact with the site before converting.

| What you see in the code | Microconversion type |
|--------------------------|---------------------|
| "Add to cart" button | \`add_to_cart\` |
| "Add to wishlist" / "Save for later" | \`add_to_wishlist\` |
| Checkout step buttons (shipping, payment...) | \`begin_checkout\`, \`checkout_shipping\`, \`checkout_payment\` |
| Newsletter/email signup form | \`newsletter_signup\` |
| PDF/resource download link | \`download\` |
| Video play button | \`video_play\` |
| Video ends | \`video_complete\` |
| Pricing page visited or pricing toggle clicked | \`pricing_view\` |
| Share/social buttons | \`share\` |
| Search form used | \`search\` |
| Filter/sort applied | \`filter_applied\` |
| Tab/accordion clicked to reveal content | \`content_expand\` |
| Chat widget opened | \`chat_open\` |
| Scroll milestones (25%, 50%, 75%, 100%) | \`scroll_25\`, \`scroll_50\`, \`scroll_75\`, \`scroll_100\` |

**Rule of thumb**: If it shows intent or engagement but isn't the final goal, it's a microconversion.

---

## Step 4: Implement conversions

### Syntax
\`\`\`js
sealmetrics.conv(type, amount, properties?)
\`\`\`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| \`type\` | string | Yes | snake_case name for this conversion |
| \`amount\` | number | Yes | Monetary value. Use \`0\` if no value (leads, signups) |
| \`properties\` | object | No | Extra metadata (see "Using properties" below) |

### Where to put it

The conversion call goes **at the moment the action succeeds**, not when the user clicks. For example:

- **Form submission**: In the \`onSubmit\` handler, AFTER validation passes (or on the thank-you page)
- **Purchase**: On the order confirmation/thank-you page, or in the success callback of the payment API
- **Signup**: After the registration API call succeeds

### Examples by pattern

**Form submit (vanilla JS):**
\`\`\`js
document.querySelector('#contact-form').addEventListener('submit', function(e) {
  // The form is about to submit — track the lead
  sealmetrics.conv('lead', 0, { form_name: 'contact', page: location.pathname });
});
\`\`\`

**Form submit (React):**
\`\`\`tsx
const handleSubmit = async (data: FormData) => {
  await api.submitContactForm(data);
  window.sealmetrics?.conv('lead', 0, { form_name: 'contact' });
};
\`\`\`

**Purchase (thank-you page):**
\`\`\`html
<!-- This script runs on /order-confirmation or /thank-you -->
<script>
  // Pull values from the page or from server-rendered data
  sealmetrics.conv('purchase', 149.99, {
    currency: 'EUR',
    payment_method: 'credit_card'
  });
</script>
\`\`\`

**Purchase (React, after payment API):**
\`\`\`tsx
const handlePayment = async () => {
  const result = await processPayment(cart);
  if (result.success) {
    window.sealmetrics?.conv('purchase', cart.total, {
      currency: cart.currency,
      payment_method: result.method
    });
    router.push('/thank-you');
  }
};
\`\`\`

**Signup (after API success):**
\`\`\`tsx
const handleRegister = async (formData: RegisterForm) => {
  const user = await api.register(formData);
  window.sealmetrics?.conv('signup', 0, { plan: formData.plan });
  router.push('/welcome');
};
\`\`\`

---

## Step 5: Implement microconversions

### Syntax
\`\`\`js
sealmetrics.micro(type, properties?)
\`\`\`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| \`type\` | string | Yes | snake_case name for this event |
| \`properties\` | object | No | Extra metadata (see "Using properties" below) |

### Where to put it

Microconversions go **on the user action** — usually in click handlers, submit handlers, or event listeners.

### Examples by pattern

**Add to cart (vanilla):**
\`\`\`js
document.querySelectorAll('.add-to-cart').forEach(function(btn) {
  btn.addEventListener('click', function() {
    sealmetrics.micro('add_to_cart', {
      product_id: this.dataset.productId,
      product_name: this.dataset.productName,
      price: parseFloat(this.dataset.price)
    });
  });
});
\`\`\`

**Add to cart (React):**
\`\`\`tsx
function AddToCartButton({ product }: { product: Product }) {
  const handleClick = () => {
    addToCart(product);
    window.sealmetrics?.micro('add_to_cart', {
      product_id: product.id,
      product_name: product.name,
      price: product.price
    });
  };
  return <button onClick={handleClick}>Add to Cart</button>;
}
\`\`\`

**Newsletter signup:**
\`\`\`js
document.querySelector('#newsletter-form').addEventListener('submit', function() {
  sealmetrics.micro('newsletter_signup', {
    position: this.closest('footer') ? 'footer' : 'inline'
  });
});
\`\`\`

**Video engagement:**
\`\`\`js
var video = document.querySelector('video');
video.addEventListener('play', function() {
  sealmetrics.micro('video_play', { video_id: this.dataset.videoId });
});
video.addEventListener('ended', function() {
  sealmetrics.micro('video_complete', { video_id: this.dataset.videoId });
});
\`\`\`

**Scroll depth tracking:**
\`\`\`js
var scrollTracked = {};
window.addEventListener('scroll', function() {
  var pct = Math.round(window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100);
  [25, 50, 75, 100].forEach(function(milestone) {
    if (pct >= milestone && !scrollTracked[milestone]) {
      scrollTracked[milestone] = true;
      sealmetrics.micro('scroll_' + milestone);
    }
  });
});
\`\`\`

**Checkout funnel steps (React):**
\`\`\`tsx
// When user moves from step to step
const goToStep = (step: number) => {
  setCurrentStep(step);
  const stepNames: Record<number, string> = {
    1: 'begin_checkout',
    2: 'checkout_shipping',
    3: 'checkout_payment',
  };
  if (stepNames[step]) {
    window.sealmetrics?.micro(stepNames[step], { items_count: cart.items.length });
  }
};
\`\`\`

---

## Step 6: Set up content grouping

Content grouping lets the site owner analyze metrics by section: "how does the blog perform vs product pages?"

### When to use it

Use content grouping when the site has **distinct sections** that serve different purposes. If the site is a single-purpose landing page, skip it.

### How to decide groups

Look at the URL structure and page purpose:

| URL pattern | Group |
|-------------|-------|
| \`/blog/*\`, \`/posts/*\`, \`/articles/*\` | \`blog\` |
| \`/products/*\`, \`/shop/*\`, \`/item/*\` | \`product\` |
| \`/category/*\`, \`/collections/*\` | \`category\` |
| \`/cart\`, \`/checkout/*\`, \`/order/*\` | \`checkout\` |
| \`/docs/*\`, \`/help/*\`, \`/faq\` | \`docs\` |
| \`/dashboard/*\`, \`/app/*\`, \`/account/*\` | \`app\` |
| \`/pricing\`, \`/plans\` | \`pricing\` |
| \`/\`, \`/about\`, \`/features\`, \`/contact\` | \`landing\` |

### How to implement it

**Option A — Static (via URL param in the script tag):**

Best when you can set a different script tag per section (e.g., different templates, layouts).

\`\`\`html
<!-- Blog layout -->
<script src="https://t.sealmetrics.com/t.js?id=SITE_ID&group=blog" defer></script>

<!-- Product layout -->
<script src="https://t.sealmetrics.com/t.js?id=SITE_ID&group=product" defer></script>
\`\`\`

**Option B — Dynamic (via JS, based on URL):**

Best for SPAs or when you can't change the script tag per section.

\`\`\`js
// Determine group from the current path
function getContentGroup() {
  var path = location.pathname;
  if (path.startsWith('/blog') || path.startsWith('/posts')) return 'blog';
  if (path.startsWith('/products') || path.startsWith('/shop')) return 'product';
  if (path.startsWith('/cart') || path.startsWith('/checkout')) return 'checkout';
  if (path.startsWith('/docs') || path.startsWith('/help')) return 'docs';
  return 'landing';
}

sealmetrics({ group: getContentGroup() });
\`\`\`

**Option C — Next.js (per layout segment):**
\`\`\`tsx
// app/blog/layout.tsx
import Script from 'next/script';
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://t.sealmetrics.com/t.js?id=SITE_ID&group=blog" strategy="afterInteractive" />
      {children}
    </>
  );
}
\`\`\`
Note: if you use per-layout scripts with groups, remove the global script from the root layout to avoid double-tracking.

---

## Using properties effectively

Properties are key-value metadata attached to conversions and microconversions. They power drill-down analysis in the dashboard.

### What to include

| Property | When to use | Example |
|----------|------------|---------|
| \`currency\` | Any monetary conversion | \`'EUR'\`, \`'USD'\` |
| \`payment_method\` | Purchase conversions | \`'credit_card'\`, \`'paypal'\`, \`'stripe'\` |
| \`plan\` | Signup/subscription conversions | \`'free'\`, \`'pro'\`, \`'enterprise'\` |
| \`product_id\` | Product-related events | \`'SKU-123'\` |
| \`product_name\` | Product-related events | \`'Wireless Headphones'\` |
| \`price\` | Add-to-cart, wishlist | \`49.99\` |
| \`category\` | Product events | \`'electronics'\`, \`'shoes'\` |
| \`form_name\` | Lead/form conversions | \`'contact'\`, \`'demo_request'\`, \`'quote'\` |
| \`position\` | UI element interactions | \`'header'\`, \`'footer'\`, \`'popup'\`, \`'sidebar'\` |
| \`video_id\` | Video events | \`'intro-video'\`, \`'product-demo'\` |
| \`search_term\` | Search events | The user's search query |

### What NOT to include

- **Order IDs, user IDs, transaction IDs** — these are high-cardinality and don't help analysis. Never put them in the type name either.
- **Email addresses, names, or PII** — SealMetrics is privacy-first.
- **Timestamps** — the system already records when events happen.
- **Page URLs** — already tracked automatically.

### Property values

- Keep values **low-cardinality** when possible: \`'credit_card'\` not \`'visa_ending_4242'\`
- Use **consistent values**: always \`'credit_card'\`, never sometimes \`'cc'\` and sometimes \`'Credit Card'\`
- **Numbers** should be numbers, not strings: \`price: 49.99\`, not \`price: '49.99'\`

---

## Naming conventions

- **snake_case** always: \`add_to_cart\`, not \`addToCart\` or \`Add To Cart\`
- **Descriptive**: \`begin_checkout\` not \`step2\`, \`newsletter_signup\` not \`nl\`
- **Stable**: once you name a type, don't rename it — it breaks historical data
- **No IDs in the type name**: \`sealmetrics.conv('purchase', 99)\`, not \`sealmetrics.conv('purchase_order_12345', 99)\`

---

## TypeScript type declarations

If the project uses TypeScript, add this declaration so \`window.sealmetrics\` doesn't show type errors:

\`\`\`ts
// types/sealmetrics.d.ts (or at the top of a component file)
declare global {
  interface Window {
    sealmetrics?: {
      (options?: { group?: string }): void;
      conv: (type: string, amount: number, properties?: Record<string, unknown>) => void;
      micro: (type: string, properties?: Record<string, unknown>) => void;
    };
  }
}
\`\`\`

Then call via \`window.sealmetrics?.conv(...)\` instead of \`sealmetrics.conv(...)\`.

---

## Complete implementation checklist

Use this to verify you haven't missed anything:

1. **Pixel installed**: Script tag is in the \`<head>\` (or root layout) of every page — ONE time only
2. **Pageviews working**: Automatic, no code needed. Verify with \`?debug=1\`
3. **Conversions identified**: Every business goal (purchase, lead, signup) has a \`sealmetrics.conv()\` call
4. **Conversion placement**: Each conversion fires at the right moment (after success, not on click)
5. **Conversion values**: Purchases have the real \`amount\`, leads/signups use \`0\`
6. **Microconversions identified**: Funnel steps and engagement signals have \`sealmetrics.micro()\` calls
7. **Properties added**: Events carry useful metadata (currency, product_id, form_name, etc.)
8. **Content grouping**: If the site has distinct sections, groups are assigned
9. **Naming**: All types are snake_case, descriptive, and stable
10. **No PII**: No emails, user IDs, or personal data in properties

---

## Debugging

Add \`?debug=1\` to any page URL to see all tracking events in the browser console:

\`\`\`
https://yoursite.com/products?debug=1
\`\`\`

Shows: session ID, account ID, event type, payload, and any errors.

---

## Technical notes

- **No cookies, no localStorage** — GDPR-friendly, no consent banner needed
- **SPA support is automatic** — History API (pushState/replaceState/popstate) is intercepted
- **Uses sendBeacon** — non-blocking, guaranteed delivery even on tab close
- **Three equivalent globals**: \`sealmetrics\`, \`sm\`, \`_sm\` — use \`sealmetrics\` in new code
- **Script loads async** with \`defer\` — never blocks page rendering
`;
