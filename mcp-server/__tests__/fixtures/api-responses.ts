/** Mock API responses matching SealMetrics API format. */

export const SITES_RESPONSE = {
  success: true,
  data: {
    total: 2,
    sites: [
      {
        id: "my-store",
        name: "My Store",
        domains: ["mystore.com"],
        timezone: "Europe/Madrid",
        currency: "EUR",
        is_active: true,
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "blog-site",
        name: "Company Blog",
        domains: ["blog.example.com"],
        timezone: "America/New_York",
        currency: "USD",
        is_active: true,
        created_at: "2025-06-15T00:00:00Z",
      },
    ],
  },
  timestamp: "2026-02-25T12:00:00Z",
};

export const OVERVIEW_RESPONSE = {
  success: true,
  data: {
    date_range: {
      start_date: "2026-01-26",
      end_date: "2026-02-25",
      days: 31,
    },
    traffic: {
      entrances: 5000,
      engaged_entrances: 4200,
      page_views: 12000,
      microconversions: 150,
      conversions: 80,
      revenue: "4500.00",
      bounce_rate: 16.0,
      pages_per_session: 2.4,
    },
    conversions: {
      conversions: 80,
      revenue: "4500.00",
      microconversions: 150,
      conversion_rate: 1.6,
      average_order_value: "56.25",
    },
    traffic_change: null,
    conversions_change: null,
  },
  timestamp: "2026-02-25T12:00:00Z",
};

export const SOURCES_RESPONSE = {
  success: true,
  data: [
    {
      utm_source: "google",
      entrances: 2500,
      engaged_entrances: 2100,
      page_views: 6000,
      conversions: 40,
      revenue: "2250.00",
      bounce_rate: 16.0,
    },
    {
      utm_source: "(direct)",
      entrances: 1500,
      engaged_entrances: 1200,
      page_views: 3500,
      conversions: 25,
      revenue: "1400.00",
      bounce_rate: 20.0,
    },
  ],
  total: 2,
  page: 1,
  page_size: 20,
  has_next: false,
  has_prev: false,
  timestamp: "2026-02-25T12:00:00Z",
};

export const PAGES_RESPONSE = {
  success: true,
  data: [
    {
      path: "/",
      entrances: 3000,
      engaged_entrances: 2600,
      page_views: 5000,
      conversions: 20,
      revenue: "1100.00",
      bounce_rate: 13.3,
    },
    {
      path: "/products/shoes",
      entrances: 800,
      engaged_entrances: 720,
      page_views: 1200,
      conversions: 15,
      revenue: "900.00",
      bounce_rate: 10.0,
    },
  ],
  total: 2,
  page: 1,
  page_size: 20,
  has_next: false,
  has_prev: false,
  timestamp: "2026-02-25T12:00:00Z",
};

export const CONVERSIONS_RESPONSE = {
  success: true,
  data: [
    {
      conversion_type: "purchase",
      count: 60,
      revenue: "3800.00",
      avg_value: "63.33",
    },
    {
      conversion_type: "signup",
      count: 20,
      revenue: "700.00",
      avg_value: "35.00",
    },
  ],
  total: 2,
  page: 1,
  page_size: 20,
  has_next: false,
  has_prev: false,
  timestamp: "2026-02-25T12:00:00Z",
};

export const DEVICES_RESPONSE = {
  success: true,
  data: {
    by_device: [
      {
        name: "desktop",
        entrances: 3000,
        engaged_entrances: 2600,
        page_views: 7500,
        conversions: 55,
        revenue: "3200.00",
        bounce_rate: 13.3,
      },
      {
        name: "mobile",
        entrances: 1700,
        engaged_entrances: 1400,
        page_views: 3800,
        conversions: 20,
        revenue: "1100.00",
        bounce_rate: 17.6,
      },
    ],
    by_browser: [
      {
        name: "Chrome",
        entrances: 2800,
        engaged_entrances: 2400,
        page_views: 7000,
        conversions: 50,
        revenue: "2900.00",
        bounce_rate: 14.3,
      },
    ],
    by_os: [
      {
        name: "Windows",
        entrances: 2000,
        engaged_entrances: 1700,
        page_views: 5000,
        conversions: 35,
        revenue: "2000.00",
        bounce_rate: 15.0,
      },
    ],
  },
  timestamp: "2026-02-25T12:00:00Z",
};

export const COUNTRIES_RESPONSE = {
  success: true,
  data: [
    {
      country: "ES",
      entrances: 2000,
      engaged_entrances: 1700,
      page_views: 5000,
      conversions: 35,
      revenue: "2000.00",
      bounce_rate: 15.0,
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
  has_next: false,
  has_prev: false,
  timestamp: "2026-02-25T12:00:00Z",
};

/** GET /stats/funnel: FunnelResponse itself, no APIResponse envelope. */
export const FUNNEL_RESPONSE = {
  account_id: "my-store",
  date_from: "2026-01-26",
  date_to: "2026-02-24",
  microconversion_types: ["add_to_cart"],
  conversion_types: ["purchase"],
  rows: [
    {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "brand",
      utm_term: "(none)",
      entrances: 3000,
      page_views: 9000,
      microconversions: { add_to_cart: 300 },
      conversions: { purchase: 50 },
      revenue: { purchase: 2500 },
    },
    {
      utm_source: "(direct)",
      utm_medium: "(none)",
      utm_campaign: "(none)",
      utm_term: "(none)",
      entrances: 2000,
      page_views: 5000,
      microconversions: { add_to_cart: 200 },
      conversions: { purchase: 30 },
      revenue: { purchase: 1500 },
    },
  ],
  totals: {
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_term: "",
    entrances: 5000,
    page_views: 14000,
    microconversions: { add_to_cart: 500 },
    conversions: { purchase: 80 },
    revenue: { purchase: 4000 },
  },
};
