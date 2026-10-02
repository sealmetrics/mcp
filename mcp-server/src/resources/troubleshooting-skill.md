---
name: troubleshooting
description: Validated symptom→cause→fix answers for the most common SealMetrics setup and data questions - tags firing before the tracker loads, lost conversions/microconversions, duplicate pageviews in SPAs or Tag Manager setups, channel rules that never match (traffic stuck in Unassigned), payment-gateway and login/SSO domains showing up as traffic sources, numbers that do not match another analytics tool, filters that seem to be ignored (country names instead of ISO codes, landing-page filters on tools that do not take one), and live browser checks of whether the tag actually loads on a page.
---

# SealMetrics Troubleshooting Guide

You are helping a SealMetrics user diagnose a setup or data problem. This guide
contains **validated support resolutions** — each entry is a real, recurring
question answered symptom → cause → fix. Follow the matching entry and use the
verification tools it lists to confirm with the user's real data. If nothing
matches, say so, check the documentation with `search_docs`, and if that does not
resolve it either, suggest contacting SealMetrics support (see the last section
for what to include).

The setup tools (`verify_setup`, `get_setup_status`, `verify_event_instrumented`)
exist only on the local MCP server, not on hosted connectors. Where this guide
names them and they are not in your tool list, use `get_overview` with
`period: "today"` and the `*_raw` tools to check what was stored instead.

Find the symptom first:

| Symptom | Section |
|---------|---------|
| Console error `sealmetrics is not defined`, conversions/micros missing, events fired from GTM | 1 |
| Pageviews or entrances look inflated (~2x) on a SPA, or content grouping missing on SPA navigations | 2 |
| A channel rule is active but traffic still shows as Unassigned (or the wrong channel wins) | 3 |
| Payment gateway (Redsys, etc.) shows up as a traffic source, or "how do I bypass the gateway referrer?" | 4 |
| An excluded login / SSO domain still appears as a top traffic source | 4 |
| SealMetrics numbers don't match GA4 / the e-commerce platform / another tool | 5 |
| No data at all, or the pixel "is not detected" | 6 |
| A country filter changes nothing, or the tool answers "Invalid country" | 8 |
| I filtered by landing page and other landing pages came back | 9 |
| Need to check live whether the tag loads on a page, or why a URL is never measured | 7 |

---

## 1. Tags fire before the tracker loads ("sealmetrics is not defined")

**Symptom**: console error `sealmetrics is not defined` (or
`sealmetrics.micro is not a function`); conversions or microconversions never
arrive. Almost always a Tag Manager setup where an event tag fires on an early
trigger (e.g. before the page — or the tag loading the tracker — has run), or a
tag injected via `document.write`.

**Cause**: the SealMetrics tracker exposes one global API (`window.sealmetrics`)
and event tags call it (`sealmetrics.micro(...)`, `sealmetrics.conv(...)`). If
an event tag runs **before** the tracker script (`t.js`) has executed, the API
does not exist yet — the call throws and that event is lost. (In SealMetrics
v1 each event tag was autonomous and built its own request, so v1 setups never
hit this; it surfaces when migrating to v2.)

**Fix — the buffer stub (canonical answer).** Paste this tiny inline snippet so
it runs **before everything else** — directly in the `<head>`, or as a GTM
Custom HTML tag on the **Initialization – All Pages** trigger:

```html
<script>
!function(w){w.sealmetrics=w.sealmetrics||function(){(w.sealmetrics.q=w.sealmetrics.q||[]).push(['pv',arguments])};w.sealmetrics.q=w.sealmetrics.q||[];w.sealmetrics.conv=w.sealmetrics.conv||function(){w.sealmetrics.q.push(['cv',arguments])};w.sealmetrics.micro=w.sealmetrics.micro||function(){w.sealmetrics.q.push(['mc',arguments])}}(window);
</script>
```

The stub creates a queue: any `sealmetrics.micro(...)` / `sealmetrics.conv(...)`
call that fires before the tracker loads is buffered and replayed automatically,
in order, the moment the real library starts. Result: no console errors, no
lost events, and a single pageview (the tracker still loads exactly once).

Key points when recommending it:

- **No other change is needed.** Event tags keep calling
  `sealmetrics.micro(...)` exactly as they do now; the loader tag keeps its
  current trigger. The only addition is the stub, first of all.
- **The stub is idempotent** (pasting it twice is a no-op thanks to the `||`
  guards) and weighs ~180 bytes gzipped.
- **Payloads are built at call time** (URL, referrer, etc. are read live when
  the call happens), so events do not depend on any earlier initialization.
- **Reject the two tempting alternatives**: (a) moving the *whole tracker* to an
  Initialization trigger is unnecessary — the stub already solves the ordering;
  (b) **tag sequencing** (firing the loader before every event tag) reloads the
  tracker several times per page and inflates pageviews. The stub avoids both.
- **If a pageview is queued through the stub** (i.e. the site fires
  `sealmetrics({...})` manually), the tracker must be loaded with `?auto=0`,
  otherwise the drained pageview AND the automatic one both fire → duplicates.
  Canonical stub pattern: **stub + `t.js?...&auto=0`**. If only `micro`/`conv`
  calls go through the stub, the `auto` setting does not need to change.
- **Iframe exception**: never inject the stub inside a sandboxed iframe (e.g.
  Shopify Web Pixels) — there, call `sealmetrics.conv()` / `sealmetrics.micro()`
  directly.
- **Always use the `sealmetrics` global**, never the `sm` / `_sm` shorthands.
  Those two are best-effort aliases: the tracker only claims them if they are
  free, so during a v1→v2 migration (v1 also registers `window.sm`) a tag
  calling `sm(...)` may silently hit the wrong tracker. Double-tagging v1+v2
  during a migration is safe as long as v2 tags call `sealmetrics(...)`.

**Verify**: reload the page with `?debug=1` appended to the URL (events are
logged to the console), then confirm the event reached the backend with
`verify_event_instrumented`, or check `get_microconversions_raw` /
`get_conversions_raw` for the expected event.

---

## 2. Duplicate pageviews on SPAs / content grouping missing on SPA navigations

**Symptom**: pageviews (and often entrances) roughly double on a single-page
app; typically the site fires its own "virtual pageview" tags from GTM (History
Change / virtualPageView triggers). Or: content grouping is set on manual
pageviews but SPA navigations still produce hits without it.

**Cause**: the tracker natively auto-fires a pageview on **every SPA
navigation** (History API `pushState` / `replaceState` / `popstate`).
`?auto=0` does **not** disable that — it only gates the *initial* pageview;
the SPA listeners stay active. So a site that also fires manual pageviews
counts every navigation twice: the automatic hit (no/static grouping) plus the
manual one (correct grouping).

**Fix**: load the tracker with **`&spa=0`** to suppress the automatic SPA
pageview and keep only the manual ones.

| `?spa=` value | Automatic pageview on SPA navigation |
|---------------|--------------------------------------|
| missing / empty / `1` | ON (default) |
| `0` | OFF (manual SPA mode) |

`auto` and `spa` are independent flags (all four combinations are valid). The
**canonical Tag Manager pattern for full manual instrumentation with per-page
content grouping** is:

```
stub (section 1)  +  t.js?id=...&auto=0&spa=0  +  one sealmetrics({ group: '...' }) per page shown
```

You fire the initial pageview and every SPA pageview yourself, exactly once
each, always with the right grouping.

Common misconceptions to correct:

- *"The script fires the pageview and my tag fills in the group afterwards."*
  No — **every `sealmetrics({ group })` call IS a complete pageview hit** with
  its own content grouping. Nothing is enriched retroactively. That is exactly
  why auto + manual = double counting.
- Automatic pageviews can only carry the **static** group from the script URL
  (`t.js?group=...`); they can never pick up a per-page group computed at
  runtime. Dynamic grouping requires manual pageviews (and therefore `spa=0`).
- Keeping the loader and the pageview/event calls in **separate tags is fully
  supported** — duplication never comes from splitting tags; it comes from
  automatic and manual pageviews both firing.
- **Timing**: fire the manual pageview **after** the URL change (the tracker
  updates its internal URL/referrer state on the History event itself). GTM's
  History Change trigger already fires after the change, so it is safe there.

**Before enabling `spa=0`, check coverage**: with it, anything your own
triggers don't cover stops being measured — typical gaps are hash-only routing
(`#/...`), AJAX checkout steps, and filter/pagination navigations. Extend the
triggers first, then flip `spa=0`.

**Verify**: browse the SPA with `?debug=1` and count one pageview per
navigation; then compare pageview counts in `get_overview` before/after.

---

## 3. Channel rules that never match (traffic stuck in Unassigned)

**Symptom**: a custom channel rule is active, priority looks right, but the
matching traffic still shows as Unassigned — or a lower-priority rule "wins".
This is almost never a publication or priority bug; it is nearly always one of
two pattern-writing traps.

How matching actually works (same engine in the pixel, the dashboard tester and
the MCP tools):

- Patterns are **RE2 regexes** (Go dialect — no lookahead/lookbehind, no
  backreferences), matched **unanchored** (substring search). An empty pattern
  is a wildcard.
- The incoming `source` / `medium` / `campaign` values are **lowercased and
  trimmed** before matching, but **patterns are applied exactly as written**.
- All non-empty patterns of a rule must match at once (AND).
- Evaluation order: your account's custom rules first (by priority, 0–1000,
  highest first), then the built-in defaults. **The first rule that matches
  wins**; if none does, the hit is Unassigned.

The two traps:

1. **Any uppercase letter in a pattern makes the rule dead.** The traffic
   arrives lowercased (`fb-sitelink`, `tradedoubler`, `app_phg`), so a pattern
   like `^FB-SiteLink$` or `(ADS|PaidSocial)` can never match — silently: the
   rule stays active, no warning is shown, and the traffic falls through to the
   next rule or Unassigned. **Write patterns entirely in lowercase.** (This
   also stays correct if pattern matching becomes case-insensitive in a future
   release.)
2. **An unescaped `.` is "any character", not a dot.** A pattern like
   `(.brand)` requires *some* character before "brand", so the bare value
   `brand.com` will not match it. Since matching is already substring-based,
   prefer plain alternatives like `(brand|otherbrand)` over
   `^.*(.brand).*$`; escape real dots as `\.` (e.g. `facebook\.com`).

Operational facts to set expectations:

- Changes to rules propagate in **~5 minutes** (pixel cache refresh).
- Classification happens **at collection time**: rule changes apply to **new
  traffic only** — historical hits are never reclassified.
- The dashboard's **"Test a visit"** (Site settings → Channels) and the MCP
  tool `test_channel_rules` use the exact same engine as live classification —
  always test the literal source/medium/campaign values before concluding a
  rule is broken. Pull real values to test with from `get_traffic_sources`.
- CSV import in the dashboard is an **atomic replace-all** of the account's
  custom rules — never import an edited export without checking that no rules
  were added after that export. (The MCP's `import_channel_rules` is safer:
  drafts-only and dry-run by default.)
- Via MCP, `create_channel_rule` / `update_channel_rule` only touch **inactive
  drafts** — publishing a rule through the MCP is never possible, whatever
  scopes the key carries; it is always a human action in the dashboard (or a
  direct API call with a publishing key, below).
- **Testing, listing and exporting rules works with a normal API key**: the
  endpoints `POST /api/v1/channel-groups/test`, `GET /api/v1/channel-groups`
  and `GET /api/v1/channel-groups/export` (and the MCP tools
  `test_channel_rules` / `list_channel_rules` / `get_channels`) accept a key
  with the `sites:read` scope — one of the scopes ticked by default (as "Read
  access") when a key is created in Settings → API Keys. If one of those calls
  answers **403 with `Required scope: one of read, sites:read,
  channel_rules:write`**, the key has none of those scopes: the scopes of an
  existing key cannot be edited, so create a new key with the default scopes
  and use that one. A 403 whose message says `Access denied to account: ...` is
  a different problem — the key does not cover that site.
- **Creating rules by API needs one of two scopes**, ticked when the key is
  created: `channel_rules:write` creates and edits **drafts only** (a human
  publishes them from the dashboard), and `channel_rules:publish` creates live
  rules and edits or deletes live ones. What a drafts key sees if it tries to
  publish: a `POST` comes back `201` with `is_active: false` plus
  `draft_forced: true`; a `PATCH` with `is_active: true` gets **403
  `Required scope: channel_rules:publish (activating a rule)`**; any `PATCH` or
  `DELETE` over a live rule gets **403 `... (rule is live)`**; an
  `import?scope=all` silently runs as `scope=drafts` and says so in the
  response. None of that is a bug — it is the scope the key was created with.
  Whichever scope is used, every change is recorded under Settings → Audit
  Logs.

**Diagnosis workflow**: `list_channel_rules` → spot uppercase letters or
unescaped dots in the failing patterns → `test_channel_rules` with the exact
real values → fix the pattern (all lowercase) → test again → publish in the
dashboard → confirm on new traffic after ~5 minutes with `get_channels` or
`get_top_channels`.

---

## 4. Payment gateways (Redsys, etc.) and referrer attribution

**Symptom**: the user wants to "add the payment gateway as a passthrough
referrer" so the sale is not attributed to the gateway — or asks why a small
`redsys / payment` (or similar) row exists in their sources.

**Answer**: common payment gateways (e.g. Redsys: `sis.redsys.es` and
variants) are already recognized **globally, out of the box** — there is
nothing to configure. When the visitor returns from the gateway within a live
session, the visit keeps its **original attribution** (the conversion is
credited to the channel that brought the user; the gateway never appears as a
source).

A small residual `<gateway> / payment` row can still appear: those are
sessions that **expired while the user was at the gateway** (a new entrance is
created on return). This is expected and marginal — not a misconfiguration.

**When the excluded domain is a login / SSO domain, that residual is not
marginal.** A payment gateway is visited mid-session, so the session is usually
still alive on return and the leftover row stays small. A login domain sits at
the **entrance** of the application instead: visitors who open the app directly
(bookmark, email link, typed URL) have no earlier session to preserve — the
return from the login is the first hit that can be recorded — so those visits
legitimately become new entrances carrying the fallback source configured for
that domain. On a property whose traffic is mostly returning logins, that row
can be one of the largest in the Sources report.

That is expected, and it does not mean the exclusion failed: **the exclusion
preserves an existing session, it cannot recreate one that never existed.**
SealMetrics is cookieless, so there is no persistent visitor id linking today's
login to an acquisition weeks ago. Sessions that *do* reach the login with a
live session keep their original source normally — those are the two branches of
the same rule, and only the second one is visible as a separate row.

**How to confirm**: call `get_top_landing_pages`. If the post-login callback
page dominates the entrances, the property is measuring logins rather than
acquisition, and the row is expected. Note also that when the application
redirects unauthenticated visitors to the login with **server-side redirects**,
no page is ever served on the app domain before the login: the tracker cannot
run there, so nothing is missing from the instrumentation and adding the pixel
"earlier" would change nothing. Section 7 shows how to verify that redirect
chain in the browser.

Custom referrer mappings beyond the built-ins (e.g. an unrecognized local
gateway or SSO domain) are currently **enabled by SealMetrics support on
request** — tell the user to contact support with the domain and the
source/medium they want it mapped to.

---

## 5. "SealMetrics doesn't match GA4 / my platform / my other tool"

Never assume a bug from a totals gap. Reconcile methodically — most gaps are
definitional, and several tools being compared undercount by design:

1. **Direction check first.** SealMetrics measures **all** visitors (no
   consent banner, no cookies), so on traffic it normally reports **more** than
   consent-gated or cookie-based tools (which lose opted-out users and some
   ad-blocked ones). SealMetrics reporting *lower* traffic than a consent-gated
   tool is a red flag worth investigating; higher is the expected direction.
2. **Compare definitions, not labels.** An *entrance* (session start) is not a
   GA4 *session*: session windows, timeout rules and attribution models differ
   per tool. Pageviews vs "events", first-click vs last-click, view-through —
   align the definition before comparing numbers.
3. **Align time.** Compare the same timezone and the same day boundaries (the
   site's reporting timezone may differ per tool), and compare **day-by-day
   series, not period totals**: a roughly uniform daily offset means a
   definitional/coverage gap; isolated spikes or cliffs mean an incident
   (deploy, tag change) on a specific date.
4. **Conversions: reconcile order-by-order, not totals.** Pull the raw list
   with `get_conversions_raw` and match against the platform's order list by
   time/amount. Orders that never render the site's thank-you page — phone
   orders, subscription renewals, app checkouts — exist in the platform but
   can never fire web tracking; conversely, page reloads or revisits of the
   confirmation page can inflate the web side if the site lacks its own
   dedup guard.
5. **Rule out double tagging** (sections 1–2) before concluding SealMetrics
   overcounts: duplicated loaders, stub+`auto=1`, or SPA auto+manual pageviews
   are the usual causes of ~2x.

---

## 6. No data at all / "the pixel is not detected"

- Confirm the tag actually loads on the page in question: view source or the
  network panel for `t.js`. Common finds: the pixel is only installed on a
  subdomain (e.g. the booking/checkout engine, not the main site), or the tag
  is loaded through a tag manager whose consent settings block it. SealMetrics
  itself needs no consent — but if the container gates the tag behind consent,
  it will not load for rejecting users.
- Append `?debug=1` to the URL to see events in the browser console.
- Use `verify_setup` / `get_setup_status` to check whether the backend has
  received any hit for the site, and `get_overview` for recent traffic.
- **The pixel answers `204` even to hits it does not store.** When `verify_setup`
  times out it returns a `cause` read from the hits rejected meanwhile. Act on it:
  - **Nothing stored and nothing rejected:** the tracker never sent a hit. Check
    the Network panel for `t.js`. A `403` means the page's domain is not one of
    the site's domains — a local dev server, a preview URL, or a domain saved in
    another form — so the tracker is refused before it can send anything. No
    `t.js` request at all means the snippet is not on the deployed page.
  - `invalid_account`: the pixel does not know the site as active yet. A new site
    takes up to 5 minutes to reach the pixel; wait and reload.
  - `invalid_domain`: the page's domain is not one of the site's domains. Test on
    the live site, or add the domain if it is the user's own; never add one only
    because it appears in the rejections, since browsers report it.
  - `bot_detected`: the session sent many pageviews within seconds (repeated
    reloads, hot reload, fast route changes) and is blocked for a while. Wait, or
    test in another browser or profile at a normal pace.
  - `blocklist_ip` / `blocklist_ua`: an excluded IP (the site's exclusions or a
    global list) or an automated browser's user agent.
  - `invalid_token`: a cached or copied tracker instead of `t.js` loaded as given.
- Section 7 shows how to check the page live instead of assuming.

---

## 7. Verifying in the browser (live checks)

Several entries above end in "check whether the tag actually loads on that
page". When the user is not sure, verify it instead of assuming it.

**If you have browser tools available** — a browser-automation MCP server such
as chrome-devtools, or any equivalent — run the checks yourself. **If you do
not**, either offer the user to install one, or walk them through the same steps
manually: open the page in a private window with the browser DevTools Network
panel open and "preserve log" enabled. Over a hosted connector there are no
browser tools available at all; use the manual path there.

Before running anything, two rules:

- **These checks load the real site and therefore generate real hits in the
  account.** On a low-traffic site, or when repeating a check many times, tell
  the user first.
- **Only ever run them against a site the user owns.**

**What to look for**

| Check | Where | What it means |
|-------|-------|---------------|
| Request to `t.js?id=<account_id>` | Network panel | The tracker is loaded on that page. Missing → not installed there, or a tag manager / consent gate is blocking it |
| `POST` to `/event` answered `204` | Network panel | The hit reached the pixel. `204` is the normal response, not an error — but rejected hits get it too (a domain the site does not list, a session flagged as a bot), so `204` alone does not mean stored. `verify_setup` says whether it was, and why not |
| Status codes of the page itself | Network panel | A chain of `30x` responses with no HTML `200` means **no page is served at all** at that URL. The tracker cannot run, and nothing is missing from the instrumentation. Typical of app URLs that bounce unauthenticated visitors to a login |
| `document.referrer` on the landing page | Console | Empty on a page reached through a redirect chain started by a bookmark or a typed URL — which is why such visits are attributed to direct traffic rather than to the redirecting domain |

**Interpreting it**: `t.js` plus a `204` on `/event`, with `verify_setup`
confirming the hit was stored, means the page is measured correctly, and any remaining attribution question is about *which session* the
hit belongs to (see sections 3 and 4), not about the tag. Confirm the backend
side with `verify_setup` or `get_setup_status`, and the resulting data with
`get_overview`.

---

## 8. A country filter changes nothing, or is rejected

**Symptom**: a report filtered by country returns exactly the same numbers as
the unfiltered one, or the tool answers `Invalid country "Spain": country must
be an ISO-3166-1 alpha-2 code...`.

**Cause**: `country` takes the **ISO-3166-1 alpha-2 code**, not the country
name — `ES`, not `Spain`; `US`, not `United States`. Casing does not matter
(`es` works). A country name is rejected with an error. If the user saw numbers
that did not change with a country name in an earlier session, those numbers were
unfiltered.

**Fix**

1. Call `get_countries` for the site and period: it returns the codes that
   actually have traffic, with their traffic volume. Use one of those.
2. Re-run the report with the code.

**Traffic with no country: `Unknown`.** The country is derived from the
**timezone the browser reports**, not from the IP address. When that timezone
maps to no country — or the browser reports none — the country is stored as the
literal `Unknown`, a real, filterable value. `country: "Unknown"` isolates that
traffic; it is not the same as "no filter". A large `Unknown` share is worth
investigating on its own (automated traffic and privacy-hardened browsers often
report no usable timezone), and it is visible in `get_countries` like any other
bucket.

**Not every report accepts a country filter.** The property reports
(`get_property_breakdown`, `get_property_values`, `list_property_keys`) do not.
If a tool does not declare `country`, passing it is an explicit error naming
the arguments it does accept.

---

## 9. "I filtered by landing page and other landing pages came back"

**Symptom**: a report was asked for one landing page and the answer clearly
covers the whole site, or the tool errors with `Unknown argument
"landing_page"`.

**Cause**: `landing_page` is not a universal filter. Most reports aggregate
data that carries no landing-page dimension, so there is nothing to filter on.

**Fix — which tools take `landing_page`**

| Tool | What it answers |
|------|-----------------|
| `get_top_sources` | The sources that brought the sessions entering on that page. The result comes from the landing-page report and therefore has **no `page_views` field** |
| `get_conversions_raw` / `get_microconversions_raw` / `get_conversion_items_raw` | One row per event, restricted to sessions that entered on that page |
| `get_landing_pages` / `get_top_landing_pages` | The landing pages themselves (one row each) — start here to get the exact path |

**Matching rules**: the match is exact and case-insensitive, and the **trailing
slash is significant** — `/shoes` and `/shoes/` are different pages. Copy the
path from `get_top_landing_pages` rather than typing it, and do not include the
domain or the query string.

For any other report, filter the other way round: get the landing page's
figures from `get_landing_pages`, or segment by the UTM values the landing page
receives.

---

## Escalating to SealMetrics support

If no entry resolves the problem, have the user contact support including:

1. The site URL (and the exact page where it fails).
2. A screenshot of the browser console error, if any.
3. **How the tracker is loaded**: tag manager or hardcoded, which trigger fires
   it, and the full script URL including parameters (`id`, `auto`, `spa`,
   `group`).
4. What was expected vs what the dashboard shows, with the date range.
