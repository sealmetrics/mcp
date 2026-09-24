# SealMetrics Implementation Prompt for AI Assistants

Use this prompt with Lovable, Cursor, Claude, or any AI assistant to implement SealMetrics tracking in your project.

---

## Prompt to copy:

```
I need you to implement SealMetrics analytics tracking in my project. SealMetrics is a privacy-first, cookieless analytics platform.

## Account Configuration
- Account ID: [YOUR_ACCOUNT_ID]
- Pixel URL: https://t.sealmetrics.com

## Base Tracker Installation

Add this script to the <head> of ALL pages:

```html
<script src="https://t.sealmetrics.com/t.js?id=[YOUR_ACCOUNT_ID]" defer></script>
```

For content grouping, add the `group` parameter:
```html
<script src="https://t.sealmetrics.com/t.js?id=[YOUR_ACCOUNT_ID]&group=home" defer></script>
```

## Pages to Track with Content Groups

Implement these content groups based on page type:

| Page Type | Content Group | Example URL |
|-----------|---------------|-------------|
| Home page | `home` | `/`, `/home` |
| Product pages | `product` | `/products/*, /product/*` |
| Category/Catalog | `catalog` | `/category/*, /shop/*` |
| Blog posts | `blog` | `/blog/*, /articles/*` |
| Blog index | `blog-index` | `/blog`, `/articles` |
| About page | `about` | `/about`, `/about-us` |
| Contact page | `contact` | `/contact` |
| Pricing page | `pricing` | `/pricing`, `/plans` |
| Services | `service` | `/services/*` |
| Portfolio/Work | `portfolio` | `/portfolio/*, /work/*` |
| Cart | `cart` | `/cart` |
| Checkout | `checkout` | `/checkout` |
| Thank you/Success | `thankyou` | `/thank-you`, `/order-confirmation` |
| Account/Dashboard | `account` | `/account/*, /dashboard/*` |
| Legal pages | `legal` | `/privacy`, `/terms` |
| 404 page | `404` | (any 404) |
| Search results | `search` | `/search` |

## Events to Track

### 1. Microconversions (Engagement Events)

Use `sealmetrics.micro(eventName, properties)` for:

```javascript
// Form submissions (contact forms)
sealmetrics.micro('form_submit', {
  form_name: 'contact_form',
  form_type: 'contact'
});

// Newsletter signups
sealmetrics.micro('newsletter_signup', {
  form_location: 'footer' // or 'popup', 'hero', 'sidebar'
});

// Add to cart (e-commerce)
sealmetrics.micro('add_to_cart', {
  product_name: 'Product Name',
  product_id: '123',
  price: '99.99',
  currency: 'EUR',
  quantity: '1'
});

// Product views (e-commerce)
sealmetrics.micro('view_item', {
  product_name: 'Product Name',
  product_id: '123',
  sku: 'SKU-123',
  price: '99.99',
  currency: 'EUR',
  category: 'Category Name',
  brand: 'Brand Name'
});

// Begin checkout
sealmetrics.micro('begin_checkout', {
  cart_total: '199.99',
  currency: 'EUR',
  items_count: '3'
});

// CTA button clicks
sealmetrics.micro('cta_click', {
  button_text: 'Get Started',
  button_location: 'hero'
});

// Video engagement
sealmetrics.micro('video_play', { video_id: 'intro' });
sealmetrics.micro('video_complete', { video_id: 'intro' });

// Scroll depth
sealmetrics.micro('scroll_50'); // 50% scroll
sealmetrics.micro('scroll_100'); // 100% scroll

// File downloads
sealmetrics.micro('file_download', {
  file_name: 'brochure.pdf'
});

// Search
sealmetrics.micro('search', {
  query: 'search term',
  results: '15'
});

// 404 errors
sealmetrics.micro('404_error', {
  url: '/broken-link'
});
```

### 2. Conversions (Revenue Events)

Use `sealmetrics.conv(eventName, value, properties)` for:

```javascript
// Purchase (e-commerce)
sealmetrics.conv('purchase', 149.99, {
  currency: 'EUR',
  payment_method: 'credit_card',
  items: [
    {
      product_name: 'Product 1',
      product_id: '123',
      price: '99.99',
      quantity: '1',
      category: 'Category',
      brand: 'Brand'
    }
  ]
});

// Lead generation (contact form that generates business)
sealmetrics.conv('lead', 0, {
  source: 'contact_form',
  form_name: 'request_quote'
});

// Signup/Registration
sealmetrics.conv('signup', 0, {
  plan: 'free' // or 'trial', 'premium'
});

// Subscription
sealmetrics.conv('subscription', 29.99, {
  plan: 'pro_monthly',
  currency: 'EUR'
});

// Booking/Appointment
sealmetrics.conv('booking', 0, {
  service: 'consultation',
  date: '2025-01-15'
});
```

## Implementation by Business Type

### SaaS / Software
```javascript
// Pricing page view
// group=pricing

// Free trial signup
sealmetrics.conv('signup', 0, { plan: 'trial' });

// Paid subscription
sealmetrics.conv('subscription', 49, {
  plan: 'pro_monthly',
  currency: 'USD'
});

// Feature usage (optional)
sealmetrics.micro('feature_use', { feature: 'export' });
```

### E-commerce
```javascript
// Product view
sealmetrics.micro('view_item', { /* product data */ });

// Add to cart
sealmetrics.micro('add_to_cart', { /* product data */ });

// Begin checkout
sealmetrics.micro('begin_checkout', { /* cart data */ });

// Purchase
sealmetrics.conv('purchase', total, { /* order data */ });
```

### Lead Generation / Services
```javascript
// Contact form submission
sealmetrics.conv('lead', 0, {
  source: 'contact_form',
  service_interest: 'consulting'
});

// Quote request
sealmetrics.conv('lead', 0, {
  source: 'quote_form',
  project_type: 'website_redesign'
});

// Newsletter (not a lead, just engagement)
sealmetrics.micro('newsletter_signup', {
  form_location: 'footer'
});
```

### Blog / Content
```javascript
// Article engagement
sealmetrics.micro('article_read', {
  article_title: 'Article Title',
  category: 'Marketing'
});

// Newsletter signup
sealmetrics.micro('newsletter_signup');

// Content download
sealmetrics.micro('file_download', {
  file_name: 'ebook.pdf',
  file_type: 'ebook'
});
```

### Booking / Appointments
```javascript
// Booking completed
sealmetrics.conv('booking', 0, {
  service: 'haircut',
  date: '2025-01-20',
  time: '14:00'
});

// Or with value
sealmetrics.conv('booking', 50, {
  service: 'consultation',
  currency: 'EUR'
});
```

## Important Rules

1. **NEVER include personal data**: No names, emails, phone numbers, addresses
2. **NEVER include order IDs**: No transaction IDs, order numbers, invoice numbers
3. **NEVER include user IDs**: No customer IDs, user identifiers
4. **DO include**: Event types, product names, categories, prices, currencies, counts
5. **Privacy first**: SealMetrics is cookieless and GDPR compliant by design

## Form Tracking Helper

For tracking forms, use this pattern:

```javascript
document.querySelectorAll('form').forEach(function(form) {
  form.addEventListener('submit', function(e) {
    var formName = form.id || form.dataset.name || 'unknown_form';
    var isNewsletter = form.classList.contains('newsletter') ||
                       form.querySelector('input[name*="newsletter"]') ||
                       formName.toLowerCase().includes('newsletter');

    if (isNewsletter) {
      sealmetrics.micro('newsletter_signup', {
        form_location: form.dataset.location || 'page'
      });
    } else {
      // Contact/lead form - use conversion
      sealmetrics.conv('lead', 0, {
        source: 'contact_form',
        form_name: formName
      });
    }
  });
});
```

## Framework-Specific Implementation

### React/Next.js
```jsx
// In layout or _app
import Script from 'next/script';

<Script
  src="https://t.sealmetrics.com/t.js?id=[YOUR_ACCOUNT_ID]"
  strategy="afterInteractive"
/>

// Track events
const trackEvent = () => {
  if (typeof sealmetrics !== 'undefined') {
    sealmetrics.micro('event_name', { prop: 'value' });
  }
};
```

### Vue/Nuxt
```javascript
// In nuxt.config.js or main.js
head: {
  script: [
    {
      src: 'https://t.sealmetrics.com/t.js?id=[YOUR_ACCOUNT_ID]',
      defer: true
    }
  ]
}

// Track events
methods: {
  trackEvent() {
    if (typeof sealmetrics !== 'undefined') {
      sealmetrics.micro('event_name', { prop: 'value' });
    }
  }
}
```

### Plain HTML/JavaScript
```html
<script src="https://t.sealmetrics.com/t.js?id=[YOUR_ACCOUNT_ID]" defer></script>

<script>
document.addEventListener('DOMContentLoaded', function() {
  // Your tracking code here
});
</script>
```

Please implement these tracking calls in the appropriate places in my codebase, ensuring all business-critical user actions are tracked while maintaining user privacy.
```

---

## Quick Reference Card

### Content Groups
- `home`, `product`, `catalog`, `blog`, `about`, `contact`, `pricing`, `service`, `portfolio`, `cart`, `checkout`, `thankyou`, `account`, `legal`, `404`, `search`

### Microconversions (sealmetrics.micro)
- `view_item`, `add_to_cart`, `begin_checkout`, `form_submit`, `newsletter_signup`, `cta_click`, `video_play`, `video_complete`, `scroll_50`, `scroll_100`, `file_download`, `search`, `404_error`

### Conversions (sealmetrics.conv)
- `purchase`, `lead`, `signup`, `subscription`, `booking`

### Never Track
- Order IDs, User IDs, Email addresses, Phone numbers, Personal names, Transaction IDs
