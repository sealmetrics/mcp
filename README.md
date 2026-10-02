# @sealmetrics/mcp

MCP server for querying [Sealmetrics](https://sealmetrics.com) analytics from Claude Code, Claude Desktop, or any MCP-compatible client.

## Setup

### 1. Get an API key

Go to **Settings > API Tokens** in your Sealmetrics dashboard and generate a new API key.

### 2. Configure your MCP client

Add to your project's `.mcp.json` or `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "sealmetrics": {
      "command": "npx",
      "args": ["-y", "@sealmetrics/mcp"],
      "env": {
        "SEALMETRICS_API_KEY": "sm_xxxx...",
        "SEALMETRICS_SITE_ID": "my-site"
      }
    }
  }
}
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SEALMETRICS_API_KEY` | Yes | Your API key (starts with `sm_`) |
| `SEALMETRICS_SITE_ID` | No | Default site ID (skips needing to pass `site_id` to every tool) |
| `SEALMETRICS_BASE_URL` | No | API base URL (default: `https://my.sealmetrics.com/api/v1`) |

## Available tools

### list_sites

List all sites accessible with your API key.

### get_overview

Dashboard KPIs: pageviews, entrances, bounce rate, conversions, revenue. Includes time series data and optional period comparison.

**Parameters:** `site_id`, `period`, `compare`

### get_traffic_sources

Traffic broken down by source (utm_source): google, facebook, direct, etc.

**Parameters:** `site_id`, `period`, `compare`, `limit`, `sort_by`, `sort_order`

### get_traffic_mediums

Traffic broken down by medium (utm_medium): organic, cpc, email, referral, etc.

**Parameters:** `site_id`, `period`, `compare`, `limit`, `sort_by`, `sort_order`

### get_campaigns

Campaign performance (utm_campaign) with entrances, conversions, and revenue.

**Parameters:** `site_id`, `period`, `compare`, `limit`, `sort_by`, `sort_order`, `utm_source`, `utm_medium`

### get_pages

Metrics per page URL path: pageviews, entrances, conversions.

**Parameters:** `site_id`, `period`, `compare`, `limit`, `sort_by`, `sort_order`, `path_filter`, multi-value filters `country`, `device_type`, `browser`, `os`, `channel_group`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `include` (`device|browser|os|channel_group`).

> **Breaking change in 1.2.0**: `country` is now `array of string` (was `string`). Pass `country: ["ES"]` instead of `country: "ES"`.

### get_landing_pages

Landing page performance: entrances, bounce rate, conversions.

**Parameters:** `site_id`, `period`, `compare`, `limit`, `sort_by`, `sort_order`, `path_filter`, plus the same multi-value filter set and `include` parameter as `get_pages` (same breaking change on `country`).

### get_conversions

Aggregated conversions by type (purchase, signup) with count, revenue, and average order value.

**Parameters:** `site_id`, `period`, `compare`, `limit`, `sort_by`, `sort_order`, `utm_source`, `utm_medium`, `country`

For per-event detail use `get_conversions_raw`. For per-product analysis use `get_conversion_items_raw`.

### get_microconversions

Aggregated microconversions (add_to_cart, newsletter_signup, etc.) by type with counts.

**Parameters:** `site_id`, `period`, `compare`, `limit`, `sort_by`, `sort_order`, `conversion_type`

For per-event detail use `get_microconversions_raw`.

### get_conversions_raw

Raw conversion rows (one per event) with `timestamp_utc`, `timestamp_local`, full attribution. Click IDs (gclid, fbclid…) are not returned — they are no longer stored. Date range capped at 31 days; `limit` capped at 100 (default 10) to control LLM token usage.

**Parameters:** `site_id`, `period` or (`start_date` + `end_date`), `page`, `limit` (1–100), `include_properties` (default `false`), and multi-value filters `conversion_type`, `country`, `device_type`, `browser`, `os`, `channel_group`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`.

When `include_properties=false` the custom `properties` map is stripped from each row to keep responses compact.

### get_microconversions_raw

Same shape as `get_conversions_raw` but for `/stats/microconversions/raw` (no `amount`).

### get_conversion_items_raw

One row per item inside a conversion (e.g. one row per product in a purchase). `properties` is **always** included — that's where `product_id`, `sku`, `price`, `quantity` live.

**Parameters:** `site_id`, `period` or (`start_date` + `end_date`), `page`, `limit` (1–100), and the same multi-value filter set as the other raw tools. Note: this tool does **not** accept `include_properties`.

### get_countries

Traffic by country with entrances, conversions, and revenue.

**Parameters:** `site_id`, `period`, `compare`, `limit`, `sort_by`, `sort_order`

### get_devices

Device type (desktop/mobile/tablet), browser, and OS breakdown in a single call.

**Parameters:** `site_id`, `period`, `compare`

### get_funnel

Funnel table broken down by UTM source/medium/campaign/term: entrances, page views, counts per microconversion and conversion type, and revenue per conversion type, plus period totals. Returns the top `limit` UTM combinations by entrances (default 100, max 500); `truncated: true` means more exist — filter by UTM to reach a small source.

**Parameters:** `site_id`, `period`, `country`, `utm_source`, `utm_medium`, `utm_campaign`, `limit`

### get_tracking_code

Get the tracking pixel code for a site and the full JavaScript API reference for implementing pageviews, conversions, microconversions, and content grouping. Use this when you need to install tracking on a website.

**Parameters:** `site_id`

## Common parameters

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `site_id` | string | `$SEALMETRICS_SITE_ID` | Site to query |
| `period` | `today`, `yesterday`, `7d`, `30d`, `90d`, `this_month`, `last_month`, `this_year`, etc. | `30d` | Time period |
| `compare` | `previous`, `yoy` | none | Comparison mode |
| `limit` | 1-100 | 20 | Max rows returned |
| `page` | number | 1 | Page number for paginated results |
| `sort_by` | varies per tool | varies | Sort field |
| `sort_order` | `asc`, `desc` | `desc` | Sort direction |

## Example usage

Once configured, you can ask Claude:

- "Show me an overview of my site for the last 7 days"
- "What are the top traffic sources this month?"
- "Compare this month's conversions with last month"
- "Which landing pages have the highest bounce rate?"
- "Show me revenue by country for Q1"

## Development

This repository holds the `@sealmetrics/mcp` package and the Claude Desktop
Extension (`.mcpb`) built from it:

| Path | What it is |
|------|------------|
| `mcp-server/` | The MCP server, published to npm as `@sealmetrics/mcp` |
| `setup-core/` | Shared setup logic (framework detection, provisioning, verification), inlined at build time |
| `integrations/prompts/` | The instrumentation guide served by `get_instrumentation_guide` |
| `fixtures/sim-contract/` | Contract fixtures for the install simulator |
| `test-site/sim/` | Pages the browser-level simulation tests load |

Requires Node.js 20 or later.

```bash
cd setup-core && npm ci && npm test
cd ../mcp-server && npm ci
npm test               # Run tests
npm run build          # Compile TypeScript
npm run pack-mcpb      # Build the Claude Desktop Extension → dist/sealmetrics.mcpb
```

## Privacy Policy

This server is published by Sealmetrics S.L. and is covered by the
[Sealmetrics Privacy Policy](https://sealmetrics.com/privacy/)
(https://sealmetrics.com/privacy/). In short, for this extension:

- **Data collection.** The server keeps no data of its own. It forwards each
  tool call to the Sealmetrics API (`my.sealmetrics.com`), authenticated with
  the API key you enter in your MCP client. `provision_site` sends the site
  name, domain, email and optional name you give it, to create a free account
  and email you a claim link. `plan_install` and `simulate_install` run on your
  machine; `detect_framework` only reads the project you point it at.
- **Usage and storage.** Responses contain aggregated analytics for the sites
  your key can access, and are returned to your MCP client. Sealmetrics stores
  account and analytics data in EU data centers.
- **Third-party sharing.** Sealmetrics does not sell data. Service providers,
  such as transactional email, process data under data processing agreements;
  the sub-processor list is Annex 3 of the [DPA](https://sealmetrics.com/dpa/).
  Your prompts and the tool results are processed by your AI assistant's
  provider (for example Anthropic) under your agreement with them.
- **Data retention.** Analytics data is retained for at most 24 months and is
  deleted automatically. Retention of account data is described in the
  Privacy Policy. The server itself retains nothing between calls.
- **Contact.** privacy@sealmetrics.com — Sealmetrics S.L., Barcelona, Spain.

## License

MIT — see [LICENSE](LICENSE).
