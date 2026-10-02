---
name: marketing
description: Diagnose marketing performance for a SealMetrics site and explain *why* the numbers move. Generalist marketing analysis (acquisition, channels, landing pages, conversions, traffic quality) with strong bias toward causal explanation and concrete next actions for Founders, CEOs and CMOs.
---

# Marketing Performance Skill (SealMetrics)

## Purpose

Help the user understand **how their marketing is performing and — more importantly — *why***, using real data from their SealMetrics account.

The skill is a playbook. Claude follows the steps in order, calls the listed SealMetrics MCP tools to fetch real numbers, interprets them with the decision logic in this document, and produces a structured markdown report with charts and a prioritized action plan.

This skill is built for **Founders, CEOs and CMOs** — not agencies. Optimize for:

- Clarity over completeness.
- "What do I do on Monday morning?" over "here is every chart."
- Causal explanation over data dumps. Every section ends in a recommendation.

The default scope is **generalist marketing**, with secondary depth in **paid / CRO** and tertiary depth in **SEO**. If the user asks for one of those focuses, weight the analysis accordingly but still surface critical findings from the other areas.

## When to use it

Use this skill when the user asks any of:

- "How is my marketing performing?"
- "Why are sales / leads / conversions down (or up) this month?"
- "What channels are working? Which are wasting budget?"
- "What should I do next?" / "Where should I invest more?"
- "Give me a marketing report for last month / quarter."
- "Compare this period to the previous one."

Do **not** use this skill for: pixel installation help, billing questions, account setup, or pure technical SEO audits (broken links, robots.txt, etc.). SealMetrics measures behavior, not crawl health.

## Output contract

A full marketing report is a single **structured markdown report** in the user's language (Spanish, English, or whatever the user wrote in). The skill itself is in English; the report is not. For a narrower question (one channel, one campaign, one symptom), run only the steps that answer it and include only those sections, plus the attribution note.

A full report includes:

1. **TL;DR** — 3-5 bullet headlines. What's working, what's broken, what to do.
2. **Period & comparison** — explicit dates resolved in the account timezone, plus the comparison baseline used.
3. **Macro snapshot** — sessions, conversions, conversion rate, vs. prior period and vs. YoY (if available), with a small trend table.
4. **Acquisition** — channels → sources → campaigns, each with a chart and a "why" interpretation.
5. **Landing pages & content** — top performers, underperformers, content group performance.
6. **Conversions & microconversions** — funnel reading.
7. **Audience** — country / device / browser only when it explains something.
8. **Traffic quality (beta)** — bot/agent share, suspicious sessions, with the beta caveat.
9. **Segments & custom properties** — only if configured (see Step 7).
10. **Why this period looks like this** — explicit causal narrative tying the sections together.
11. **Action plan** — 3-7 prioritized actions, scored by impact × effort, with what to measure.

Use markdown tables and inline ASCII bar charts (see Chart conventions). No images, no external links, no PII.

## Pre-flight

### Step 0 — Site selection and period resolution

**What to do**

1. Call `list_sites` to get the user's sites. Do **not** assume a `site_id`.
2. If exactly one site is returned, use it and tell the user which one you picked.
3. If multiple sites are returned, list them by name + url and ask the user to pick.
4. Once a `site_id` is chosen, call `get_site` to capture timezone, currency, and any flags (e.g. agent analytics enabled).
5. Resolve the analysis period:
   - Default: **`30d`** (last 30 days) in the account timezone.
   - Always request two comparison baselines when data exists, via the `compare` parameter **on the tools that support it** (see the list below):
     - **Prior period** of equal length → `compare: "previous"`.
     - **Year-over-year** (same window, one year earlier) → `compare: "yoy"`.
   - State the resolved date ranges explicitly in the report header.

**How to interpret / decide**

- Never resolve `period` with the server clock. SealMetrics resolves date ranges in the account timezone — pass one of the **valid preset strings** and let the backend resolve them. Valid values: `today`, `yesterday`, `7d`, `30d`, `90d`, `12m`, `this_week`, `wtd`, `last_week`, `this_month`, `mtd`, `last_month`, `this_quarter`, `qtd`, `last_quarter`, `this_year`, `ytd`, `last_year`. There is **no** `last_30_days`/`last_7_days` form — use `30d`/`7d`.
- Get comparisons from the tool itself with `compare: "previous"` or `compare: "yoy"` rather than calling it twice. **`compare` is supported only on**: `get_overview`, `get_traffic_sources`, `get_traffic_mediums`, `get_campaigns`, `get_terms`, `get_pages`, `get_landing_pages`, `get_conversions`, `get_microconversions`, `get_countries`, `get_devices`. It is **not** supported on `get_channels`/`get_top_channels`, the `get_top_*` ranked variants, the `*_raw` tools, or the `list_*` tools. When you need a prior-period comparison from a tool that lacks `compare` (notably channel mix in Step 2a), call it twice with a **calendar-pair preset** — `this_month` vs `last_month`, or `this_quarter` vs `last_quarter` — since `30d` has no matching prior-window preset. Tools that do not list `compare` reject it with an "Unknown argument" error.
- If the site has < 14 days of data, skip YoY and warn the user that comparisons are noisy.
- If currency is set, format monetary figures with that currency throughout the report.

**Tools**: `list_sites`, `get_site`.

## Attribution model declaration

Before any channel or campaign reading, the report must include this disclaimer **once**, in the user's language:

> SealMetrics uses **last non-direct click, consentless attribution** measured server-side. Numbers will *not* match GA4 (which uses data-driven attribution and depends on consent) or ad platform dashboards (which use platform-side click/view attribution). When the user compares numbers across tools, this is the most common reason they differ.

This single sentence prevents 80% of "but my Google Ads dashboard says..." follow-ups.

## Steps

For a full report, run the steps in order and skip a step only if its data is empty, not configured, or its tools are unavailable on this connection.

---

### Step 1 — Macro snapshot

**Goal**: establish the headline numbers and direction of travel.

**Tool**: `get_overview` with `compare: "previous"` and, when ≥ 1 year of data exists, a second call with `compare: "yoy"`. One call per baseline — not three manual period calls.

**Extract** (note the field names — SealMetrics calls a session an **`entrance`**; there is no `sessions` field):

- Sessions → field `entrances`
- Pageviews → field `page_views`
- Conversions (count and value if available)
- Conversion rate (conversions / `entrances`)
- Bounce rate → field `bounce_rate` (already computed; do not recompute)
- Engagement — **derived**, not a returned field: `engaged_entrances / entrances` (engagement-rate is not in the response; bounce is the canonical engagement signal in SealMetrics)
- Revenue if e-commerce

In the report you may still write "sessions" (user-facing wording), but when reading tool output map it to `entrances` / `engaged_entrances`.

**Render** as a comparison table:

```
Metric            | Current   | Prior     | Δ       | YoY      | Δ YoY   | Trend
------------------|-----------|-----------|---------|----------|---------|------
Sessions          |    12,430 |    10,820 | +14.9%  |   9,950  | +24.9%  | ↑
Conversions       |       262 |       265 |  -1.1%  |     210  | +24.8%  | →
Conversion rate   |     2.11% |     2.45% | -13.9%  |   2.11%  |   0.0%  | ↓
Revenue           |   €18,340 |   €19,210 |  -4.5%  | €14,200  | +29.2%  | →
Bounce rate       |    52.4%  |    48.1%  |  +8.9%  |   55.0%  |  -4.7%  | ↓
```

(Use real numbers from the tool result — the table above is a layout example.)

**How to read**:

- **Same direction, both baselines** (e.g. down vs. prior and down vs. YoY) → systemic issue, prioritize investigation.
- **Diverges** (e.g. up YoY but down vs. prior period) → recent regression. Look for what changed in the last 30 days: campaigns paused, landing changes, seasonality, ad fatigue.
- **Volume up, conversions flat** → quality of traffic dropped. Continue to Step 6 (traffic quality) and Step 2 (channel mix).
- **Volume flat, conversion rate dropped** → something broke on-site (landing, funnel, checkout). Prioritize Step 3 and Step 4.
- **Volume up, conversion rate up, revenue flat** → AOV or product mix shifted. Look at conversion-level breakdown in Step 4.

End Step 1 with a one-sentence narrative: *"Traffic grew but converted worse — investigation focuses on traffic quality and landing experience."*

---

### Step 2 — Acquisition diagnosis (channels → sources → campaigns → terms)

**Goal**: identify which acquisition lanes are driving the macro pattern from Step 1.

Run **top-down**. Don't jump to campaign-level until you know which channel changed.

**Sub-step 2a — Channel mix**

Tool: `get_channels` (full list) and `get_top_channels` (ranked). Neither accepts `compare` — to read channel mix vs. the prior period, call `get_channels` twice with a calendar-pair preset (`this_month` vs `last_month`, or `this_quarter` vs `last_quarter`) and diff the results yourself.

Render a stacked-share table with a bar chart:

```
Channel        | Sessions | Share  | Conv. | Conv. rate | Bar
---------------|----------|--------|-------|-----------|----------------------
Organic Search |    5,210 | 41.9%  |   142 |     2.7%  | ████████████████████░
Direct         |    3,100 | 24.9%  |    66 |     2.1%  | ████████████░░░░░░░░░
Paid Search    |    1,820 | 14.6%  |    24 |     1.3%  | ███████░░░░░░░░░░░░░░
Referral       |    1,150 |  9.2%  |    18 |     1.6%  | █████░░░░░░░░░░░░░░░░
Social         |      720 |  5.8%  |     8 |     1.1%  | ███░░░░░░░░░░░░░░░░░░
Email          |      430 |  3.5%  |     4 |     0.9%  | ██░░░░░░░░░░░░░░░░░░░
```

Always show **both volume and conversion rate per channel**. A channel can be the largest source of sessions and the worst converter — that's a finding.

**How to read**:

- Compare current channel mix vs. prior period. The biggest absolute mover is the prime suspect for the macro change.
- A channel whose conversion rate dropped while its volume stayed flat is a **quality** problem (creative, audience, landing match).
- A channel whose volume dropped is a **distribution** problem (algorithm change, budget cut, seasonality).
- Direct is a residual bucket. A sudden spike in direct often means **broken UTM tagging on a paid campaign** — investigate Step 2c before celebrating.

**Sub-step 2b — Sources & mediums**

Tools: `get_traffic_sources`, `get_top_sources`, `get_traffic_mediums`, `get_top_referrers`.

For the channels that moved most in 2a, drill into source/medium. Look for:

- New referrers that didn't exist last period (PR hit? viral content?).
- Source quality drift (e.g. `google / organic` sessions up but its conversion rate down → query intent shifted, possibly AI Overviews stealing high-intent clicks).
- Referrer concentration: is one referrer carrying the channel? That's fragile.

**Sub-step 2c — Campaigns**

Tools: `get_campaigns`, `get_top_campaigns`.

For paid users, this is the most actionable section. Render a table with **spend signals only via conversion data** (SealMetrics does not ingest ad spend by default):

```
Campaign            | Sessions | Conv. | Conv. rate | Rev.     | Note
--------------------|----------|-------|-----------|----------|----------------
brand_search_es     |    1,210 |    62 |    5.1%   | €7,200   | Top performer
generic_search_es   |    1,840 |    18 |    1.0%   | €1,950   | Underperformer
display_retargeting |    2,100 |    12 |    0.6%   | €1,100   | Watch
youtube_awareness   |      910 |     2 |    0.2%   | €180     | Reconsider
```

**How to read**:

- A brand campaign converting at 5%+ while generic search converts at <1% is normal — but if generic search is *most of the spend*, it's likely cannibalizing brand or buying low-intent clicks.
- A retargeting campaign with worse conversion rate than cold traffic = audience exhaustion or creative fatigue.
- An awareness campaign should be judged by its **assisted** effect (lift in direct + organic-brand in the following weeks), not its direct conversion rate. SealMetrics is last non-direct click — flag this caveat to the user before they kill an awareness campaign on a single-touch reading.

**Sub-step 2d — Search terms (organic + paid)**

Tool: `get_terms`.

Only call if Step 2a or 2b suggested a search-channel change. Look for:

- Top converting terms that lost share → ranking drop or platform-side bidding change.
- Long-tail growth → topical authority building (SEO win) or query expansion (paid).
- High-impression / zero-conversion terms (paid only) → negative keyword candidates.

**End-of-step narrative**: tie 2a–2d together. *"The conversion rate drop in Step 1 is concentrated in `google / cpc` — specifically the `generic_search_es` campaign — which doubled its traffic share but its converting terms have not changed. Hypothesis: broader match types are pulling lower-intent queries."*

---

### Step 3 — Landing pages & content

**Goal**: separate **what the user lands on** from **what they browse**. Marketing performance lives in the landing experience.

**Tools**: `get_landing_pages`, `get_top_landing_pages`, `get_landing_pages_by_content_group`, `get_pages`.

**Render** two tables:

**Top landing pages by entrances:**

```
Landing page             | Entrances | Bounce | Conv. rate | Δ Conv. rate vs. prior
-------------------------|-----------|--------|-----------|-----------------------
/                        |     3,820 |  48.2% |    1.9%   | -22% ↓
/pricing                 |     1,420 |  41.0% |    4.8%   | +5%  →
/blog/seo-attribution    |       980 |  72.1% |    0.4%   | -10% ↓
/integrations/shopify    |       640 |  35.5% |    6.1%   | new
```

**How to read**:

- A landing page with **high entrances + high bounce + low conversion** is the biggest leak. If its conversion rate also dropped vs. prior, it's the prime suspect for the macro change in Step 1.
- A blog post landing with a low conversion rate is **expected** (informational intent). Don't recommend "improve conversion" on blog landings unless the user has a clear blog→signup goal. Suggest internal linking or content upgrades instead.
- A **new** landing page in the top 10 means something changed in routing or a campaign points there — verify intent match.
- A landing page whose conversion rate dropped while traffic to it stayed flat → page or funnel regression (test a fix). One whose conversion rate held but traffic dropped → upstream channel issue (loop back to Step 2).

**Content groups** (`get_landing_pages_by_content_group`):

If the site has content groups configured, render share-of-entrances by group:

```
Content group   | Entrances | Share | Conv. rate
----------------|-----------|-------|----------
product         |     4,210 | 33.8% |   4.2%
pricing         |     1,420 | 11.4% |   4.8%
blog            |     3,650 | 29.3% |   0.5%
home            |     2,150 | 17.3% |   1.9%
other           |       900 |  7.2% |   1.1%
```

This often reveals strategic mismatches: "60% of acquisition is into the blog but the blog converts at 0.5% — content is bringing the wrong audience, or the conversion path from blog is broken."

If content groups are not configured, skip this sub-step and note it as a setup opportunity in the action plan.

---

### Step 4 — Conversions & microconversions

**Goal**: explain *what* converted and *which steps* are leaking.

**Tools**: `get_conversions`, `list_microconversion_types`, `get_microconversions`. Use `get_conversions_raw` and `get_microconversions_raw` only when the user asks for an audit-level breakdown — they are heavier and **constrained**: ranges longer than 31 days are rejected (so `90d`, `12m` or `this_quarter` fail; `30d`, `last_month` or `start_date`/`end_date` work), and each call returns at most 100 rows. Use the aggregated tools for macro windows.

**Read conversions**:

- Total conversion count and value vs. prior period and YoY.
- Top converting pages (where conversions complete).
- Conversion mix: if multiple conversion types exist (purchase, signup, demo), is the mix shifting?

A drop in conversion *count* with stable revenue → fewer but higher-value buyers. A drop in *value* with stable count → discount-heavy mix or AOV erosion.

**Microconversions as the explanatory layer**:

Microconversions are **support signals**, not goals. Their job in this skill is to explain *why* a month is better or worse than another.

1. Call `list_microconversion_types` to discover what is configured (e.g. `add_to_cart`, `scroll_75`, `video_play`, `pricing_view`, `cta_click`).
2. Call `get_microconversions` for the current and prior period.
3. Render the funnel as a step-down chart:

```
Step                  | Sessions | % of prev | Bar
----------------------|----------|-----------|---------------------
Sessions              |   12,430 |    100.0% | ████████████████████
pricing_view          |    3,610 |     29.0% | ██████░░░░░░░░░░░░░░
cta_click_demo        |      820 |     22.7% | █████░░░░░░░░░░░░░░░
demo_form_view        |      540 |     65.9% | █████████████░░░░░░░
demo_conversion       |      262 |     48.5% | ██████████░░░░░░░░░░
```

**How to read**:

- The step with the **largest drop in step-over-step retention vs. prior period** is the explanation for the macro change. Examples:
  - `pricing_view → cta_click_demo` retention dropped from 30% to 22% → the pricing page or its CTA changed, or visitors are arriving with lower intent.
  - `demo_form_view → demo_conversion` dropped from 60% to 48% → form friction, validation errors, or trust signal lost.
- If macro conversions dropped but **no funnel step regressed**, the cause is upstream: it's a traffic-mix issue (Step 2) or a channel-level intent drop, not a site issue.
- If no microconversions are configured, **say so explicitly** and add to the action plan: "Configure microconversions (`pricing_view`, `cta_click_*`, `form_view`) so that next month's report can attribute *why* the funnel moved."

---

### Step 5 — Audience

**Goal**: surface audience mix only when it **explains** a macro change. Don't dump demographics for the sake of it.

**Tools**: `get_countries`, `get_devices`, `get_device_types`, `get_browsers`.

**Heuristics for when to include each in the report**:

- **Country mix**: include if the top-5 country share moved by > 5 percentage points vs. prior, or if a campaign targeted a new geo. Compare country-level conversion rates — entering a new geo with no localized landing tends to spike sessions and tank conversion rate.
- **Device type** (mobile vs. desktop vs. tablet): include if device mix moved or if conversion rate gap between devices widened. A widening gap is usually a **mobile UX regression** or a campaign pushing mobile-heavy placements.
- **Browser**: include only if there is an anomaly (e.g. Safari conversion rate collapsed → ITP / cookie regression; specific browser version concentrated in bounced sessions → rendering bug).

**Important**: the `country` field in SealMetrics is currently derived from **browser timezone**, not IP geolocation. Treat country splits as directional, not precise. Do not use country data to make claims about VAT, legal jurisdiction, or compliance.

---

### Step 6 — Traffic quality (beta)

**Goal**: estimate what share of the measured traffic is bots, scrapers, or AI agents — because that directly distorts every metric above.

**Tools**: `get_bot_stats`, `get_suspicious_sessions`.

These tools are not available on every connection (hosted connectors do not expose them). If they are not in your tool list, skip this step and say once that traffic-quality data is not available over this connection.

**Always include this disclaimer in the report (in the user's language)**:

> Traffic quality and agentic-traffic detection are currently in **beta** in SealMetrics. The numbers in this section are useful as directional signals, not as accounting truth. We are actively improving classification accuracy.

**Read**:

- **Bot share**: % of sessions classified as bots or suspicious. If this share moved meaningfully vs. prior (≥ 3 percentage points either way), it is a candidate explanation for macro shifts.
- A **rising** bot share inflates session counts and *deflates* conversion rate — if Step 1 showed sessions up but conversion rate down, check this first.
- A **falling** bot share (e.g. because classification improved) can artificially make conversion rate look better. Note this and avoid celebrating a fake win.
- Suspicious-session patterns (`get_suspicious_sessions`) — if a single referrer or country dominates the suspicious list, surface it. This is also where scraper / agent traffic from LLM browsers tends to show up.

Handle the two non-data cases distinctly — `get_bot_stats` does **not** return a literal "not enabled" status:

- **Empty result** (`total_hits: 0`, zero-filled distribution): there is no bot data for the period — usually because agent analytics is not enabled on the site. Do **not** present the zeros as a real 0% bot share. Skip the section and tell the user once: *"No traffic-quality data for this period — agent analytics may not be enabled on this site. You can enable it in your account settings; it is the most reliable way to know whether a conversion-rate change is real or noise."*
- **403 / "Access denied to this account"**: a permissions problem, not a data problem. Say so plainly and move on; do not retry.

---

### Step 7 — Custom segments & properties (optional)

**Goal**: use custom dimensions the user has already configured to add depth. This step assumes setup exists — if it doesn't, skip and invite setup.

**Tools**: `list_segments`, `get_segment`, `list_property_keys`, `get_property_values`, `get_property_breakdown`.

`list_segments` and `get_segment` are not exposed on hosted connectors; if they are missing, skip the segment part and do the property part.

**Flow**:

1. Call `list_segments`. If empty → skip and note in the action plan: *"No segments configured. Set up at least one segment for your highest-value audience (e.g. 'logged-in users', 'returning visitors') — it makes monthly reads 10× more diagnostic."*
2. If segments exist, call `get_segment` for the high-priority ones. It returns the segment's filter definition only, with no metrics, and the report tools take no segment argument. Where the filters map to named arguments (country, device_type, channel_group, utm_*), re-run the relevant report with them and compare against the site total; otherwise describe the segment and say its metrics are only available in the dashboard. A segment that is 8% of sessions but 35% of conversions is a goldmine — recommend dedicated landing pages and creative for it.
3. Call `list_property_keys`. For up to 3 of the most informative keys (typical examples: `pricing_plan`, `industry`, `signup_source`), call `get_property_breakdown` to surface **counts and revenue** by property value (these tools return distribution and revenue per value, **not** a per-value conversion rate — don't promise one).
4. If no property keys exist → invite the user to instrument key events with custom properties so future reports can answer "which *kind* of customer is converting."

Do **not** dump every segment and every property. Pick the ones that change the narrative.

---

## The "why" decision trees

These are the diagnostic playbooks to run when the data shows the matching symptom — they convert the report from a data dump into an explanation.

### Symptom A — Conversion rate dropped (most common request)

Run in this order. Stop at the first match that fully explains the magnitude.

1. **Bot share rose** (Step 6). Inflated denominator. → Adjust expectations, re-baseline once classification stabilizes.
2. **Channel mix shifted toward lower-converting channels** (Step 2a). → Even if individual channels are stable, the weighted average dropped. Action: rebalance spend or fix the diluting channel's intent.
3. **A specific high-volume campaign** (Step 2c) lost conversion efficiency. → Audit creatives, match types, landing assignment.
4. **A specific landing page regressed** (Step 3). → Compare against last period and against itself a year ago. Look for recent changes — copy, hero, CTA position, page speed.
5. **A specific funnel step regressed** (Step 4). → Inspect that step's page and any release-note around its deploy date.
6. **Audience mix shifted to lower-converting segments** (Step 5). → New geo, new device skew, new browser anomaly.
7. **Seasonality**. → Compare YoY; if YoY conversion rate is flat and only QoQ dropped, the cause is seasonal. Action: nothing tactical, set expectations correctly.

### Symptom B — Traffic up but revenue flat (or down)

1. **Bot/agent share rose** (Step 6). Phantom traffic.
2. **A new low-intent source dominates** (Step 2b). Could be a viral blog hit bringing wrong audience.
3. **Mobile share rose** (Step 5) with mobile converting worse than desktop. → Mobile UX investment, accelerated mobile-first redesign of top landings.
4. **AOV dropped** (Step 4). Promo-heavy mix, product mix shift, discount campaign cannibalization.
5. **Microconversions show intent dropped** at the pricing or cart step (Step 4). → Landing quality is fine, but the offer / pricing / trust signals weakened.

### Symptom C — This month worse than last (open-ended)

Always look at **microconversions** first (Step 4). They are the leading indicators of what changed. If `add_to_cart` dropped → product page or pricing perception. If `pricing_view` dropped → top-of-funnel awareness or messaging issue. If form views are flat but submissions dropped → form / friction issue.

Then walk Step 1 → Step 4 in order and stop at the first significant regression. The skill should produce a narrative sentence like:

> *"The 13% drop in conversions is mostly explained by `/pricing` losing 22% of its visitors after a redesign on 2026-06-10, while channel mix and traffic quality are stable."*

### Symptom D — Paid CAC rising

1. **Conversion rate dropped for the specific paid campaign** (Step 2c) → creative fatigue or audience exhaustion. Test new angles.
2. **Click-to-landing match deteriorated** — campaign landing-page conversion rate fell while organic conversion rate held → landing/messaging mismatch.
3. **Bot share rose specifically in paid sources** (Step 6) → click fraud or attribution noise. Action: enable IP exclusions in the ad platform; flag to platform support.

### Symptom E — Organic search dropped

1. **Top converting terms lost share** (Step 2d) → ranking drop or AI Overviews intercepting high-intent queries.
2. **Branded organic flat, generic organic dropped** → algorithm or competition; SEO investment.
3. **Branded organic dropped** → broader brand-demand issue (PR, awareness campaigns paused, NPS).

---

## Threshold philosophy

Be opinionated, but mostly **relative to the site's own history**.

- A metric is **moving** if it changed by ≥ 10% vs. prior period *and* by more than 1 standard deviation of its recent weekly noise.
- A metric is **stable** if it changed by < 5% — do not over-interpret.
- A landing page or campaign needs ≥ 200 sessions in the period before any conversion-rate comparison is statistically interesting. Below that, label readings as **directional**.

**Absolute red flags** (use sparingly, only at extremes):

- Bounce rate > 80% on a paid landing with > 200 entrances → broken landing or wrong audience.
- Mobile conversion rate < 30% of desktop conversion rate → likely mobile UX failure (not just behavior).
- Bot share > 25% → measurement is compromised; surface as the top finding.
- Paid campaign with > 500 sessions and < 0.5% conversion rate → almost always a waste, recommend pause-and-rebuild.

State thresholds plainly in the report. The CMO needs to know whether a number is "bad" or just "different."

---

## Chart conventions

Charts are text. Use them generously — the user reads markdown.

**Horizontal bar (share / comparison)**:

```
Item    | Value | Bar (20 chars wide)
--------|-------|--------------------
A       | 41.9% | ████████████████████░
B       | 24.9% | ████████████░░░░░░░░░
```

Bar length: `round(value / max_value * 20)` filled, rest as `░`. Always normalize against the **max in the chart**, not 100%, so the chart is readable when the values are small.

**Trend cell**: use `↑` (≥ +10%), `↓` (≤ -10%), `→` (between). Never use color (won't render).

**Funnel** (step-down): show absolute count per step and step-over-step retention as a percentage. Always include the % of previous step — that's the diagnostic number.

**Time comparison table**: always include Δ% column and a trend arrow. Two baselines (prior, YoY) when data permits.

Keep tables narrow (≤ 6 columns). If you need more, split into two tables.

---

## Recommendations framework

Every section ends with a recommendation. The final **Action plan** consolidates them and prioritizes.

For each recommended action, state:

- **What** to do — concrete, not "improve conversion."
- **Why** — which finding in the report it addresses, with a number.
- **Impact** — High / Medium / Low, based on the size of the underlying lever (e.g. a leak on a page that gets 30% of entrances = High).
- **Effort** — Low / Medium / High in terms of time-to-ship (Low = under a day, Medium = a sprint, High = a project).
- **Measure** — which metric in the next report will tell us whether it worked.

Render as a prioritized table sorted by impact-then-effort:

```
# | Action                                              | Why                       | Impact | Effort | Measure
--|-----------------------------------------------------|---------------------------|--------|--------|------------------
1 | Rebuild /pricing hero: clarify offer + add trust    | -22% conv. on top landing | High   | Medium | Pricing landing conv. rate
2 | Pause `generic_search_es` broad match groups        | 1.0% conv. vs 5.1% brand  | High   | Low    | Paid conv. rate (overall)
3 | Add microconversion `pricing_cta_click`             | Unblocks next month's why | Medium | Low    | New event in next report
4 | Configure mobile-first landing variant for /home    | Mobile -45% vs desktop    | High   | High   | Mobile conv. rate
5 | Add content group `comparison` and segment it       | Bottom-of-funnel intent   | Medium | Low    | Conv. rate of group
```

Cap at 7 actions. More than that and the CMO does none of them.

---

## What NOT to do

- **No PII, ever.** Never ask for, surface, or print emails, names, user IDs, order IDs, phone numbers, full IP addresses, or any field that could identify an individual. SealMetrics is consentless analytics — the whole architecture depends on no PII. If a tool returns a field that looks identifying, omit it.
- **Do not invent data.** Every number must come from a tool result in this session. If a tool returns empty or errors, say so. Never fill gaps with plausible figures.
- **Do not resolve dates in UTC or with the server clock.** Pass a valid `period` preset (`30d`, `7d`, `last_month`, `this_year`, …) and let SealMetrics resolve it in the account timezone. Do **not** invent forms like `last_30_days`.
- **Do not compare SealMetrics numbers head-to-head with GA4 or ad platforms.** Different attribution models, different consent assumptions. State this when the user mentions another tool.
- **Do not dump every breakdown.** The CMO does not want 14 tables. Show only the breakdowns that explain the macro change or recommend an action.
- **Do not recommend killing an awareness or top-of-funnel campaign on direct-conversion data alone.** Note the last non-direct-click attribution caveat and suggest a multi-week assisted-effect read.
- **Do not declare causation from one period of data.** Use language like "the most likely explanation," "consistent with," "candidate causes." Reserve "caused" for cases where the user already confirmed the timeline (e.g. "we paused the campaign on the 10th").
- **Do not skip the bot/agent section because it's beta.** When the tools are available, surface it with the disclaimer. Ignoring traffic quality is how marketers fool themselves.
- **Do not assume segments or custom properties exist.** Probe with `list_segments` / `list_property_keys`. If empty, invite setup — don't fabricate.
- **Do not call `*_raw` tools by default.** They return higher-cardinality data; use them only when the user asks for an audit or when a small-N section needs validation.
- **Do not call `get_terms` or `get_landing_pages_by_content_group` first.** They are drill-downs. Start from `get_overview` → `get_channels` and only drill where Step 1 and 2 point you.

---

## Report template (for the final output)

Use this skeleton, in the user's language. Fill it with real numbers and findings.

```
# Marketing report — {site name}
**Period**: {dates in account timezone}
**Comparison**: prior period {dates} · YoY {dates if available}
**Attribution**: SealMetrics last non-direct click, consentless (numbers may differ from GA4 or ad platforms).

## TL;DR
- 3 to 5 bullets. Headline finding, headline action, headline caveat.

## Macro snapshot
{table from Step 1}
{one-sentence narrative}

## Acquisition
### Channel mix
{chart + interpretation}
### Sources & referrers
{interpretation if anything notable}
### Campaigns
{table + interpretation}
### Search terms
{only if relevant}

## Landing pages & content
{top landings table + interpretation}
{content group table if configured}

## Conversions & microconversions
{conversion summary}
{funnel chart + which step explains the period}

## Audience
{only sections that explain something}

## Traffic quality (beta)
{bot share + suspicious patterns + disclaimer}

## Segments & custom properties
{only if configured}

## Why this period looks like this
A 3-5 sentence causal narrative tying the sections together. State confidence and uncertainty plainly.

## Action plan
{prioritized table, max 7}

## What to set up before next report
{instrumentation gaps surfaced during the run — content groups, microconversions, segments, properties — so next month's analysis can go deeper}
```

---

## Glossary

- **Session**: a visit by a single browser, bounded by inactivity timeout.
- **Conversion**: a goal completion as configured by the site (purchase, signup, demo, etc.).
- **Microconversion**: an in-session intent signal short of full conversion (pricing view, scroll depth, CTA click).
- **Engaged session**: a session with more than one pageview (microconversions do not count toward engagement).
- **Bounce rate**: `(entrances − engaged entrances) / entrances`. SealMetrics computes bounce, not engagement rate.
- **Last non-direct click**: attribution model that credits the last channel before conversion that is not a direct visit.
- **Consentless**: measurement done server-side without setting identifiers in the browser; no cookie banner required for this data.
- **Content group**: a logical grouping of pages (e.g. `product`, `blog`, `pricing`) configured at the site level.
- **Segment**: a saved cohort defined by behavior or properties (e.g. "logged-in users").
- **Custom property**: a key/value attached to events (e.g. `plan=pro`) used for breakdowns.
