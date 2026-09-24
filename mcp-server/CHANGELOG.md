# Changelog

All notable changes to `@sealmetrics/mcp` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

_History before 1.2.0 is not maintained here — see `git log mcp-server/` for
earlier changes._

## [1.10.2] — 2026-09-22

### Changed — ready for Anthropic's Desktop Extensions directory

- The `.mcpb` manifest moves to `manifest_version` 0.3 and declares its
  privacy policy (`privacy_policies`: https://sealmetrics.com/privacy/). The
  README gains a **Privacy Policy** section covering what the server sends,
  where it is stored, third parties, retention and contact.
- Documentation, support and repository links point at public destinations:
  docs.sealmetrics.com and the public `sealmetrics/mcp` repository.
  The `author` URL is the organization's GitHub profile.
- Ships an MIT `LICENSE` file, also inside the npm package.

### Fixed

- Write tools declare `destructiveHint` explicitly. Undeclared, the protocol
  reads it as `true`, so `provision_site` and `create_channel_rule`, which only
  add, looked destructive. `update_channel_rule`, `delete_channel_rule` and
  `import_channel_rules` declare `true`.

## [1.10.1] — 2026-09-21

### Fixed — de dónde sale `Unknown`

- Las descripciones de `country` y la guía de troubleshooting decían que
  `Unknown` era tráfico **cuya IP no se pudo geolocalizar**. Es falso: el país
  se resuelve a partir del **timezone que declara el navegador**
  (`geoResolver.Resolve(payload.Timezone)` en el pixel), nunca de la IP, que no
  se usa para esta dimensión. `Unknown` es el timezone que no corresponde a
  ningún país. Solo texto: el comportamiento de 1.10.0 no cambia.

## [1.10.0] — 2026-09-21

### Fixed — filters that looked applied but were not (PRD-062)

- **Unknown arguments are an error, not a shrug.** A tool called with an argument
  it does not declare (`country` on a tool without it, `landing_page` on a report
  that has no landing dimension) answered with unfiltered numbers, because the
  schema dropped the key in silence and the model reported a filter it never
  applied. Every tool now publishes `additionalProperties: false` and answers
  `Unknown argument "<x>" for <tool>. Accepted: <list>.` — before any HTTP call.
- **`country` takes a code, and says so.** A country name (`Spain`) is rejected by
  the MCP itself with the expected format and a pointer to `get_countries`; it is
  never translated. The API used to answer three different ways to the same
  mistake — a 500 on some reports, unfiltered numbers on others.
- **`Unknown` is a filterable country.** The country comes from the timezone the
  browser reports (never from the IP); when it maps to no country it is stored as
  the literal `Unknown`. `country: "Unknown"` now isolates it (or excludes it by
  picking the real codes), in the MCP and in the API.
- A `400` from the API (date-range errors: `start_date` after `end_date`, an
  unknown period, a range over 730 days) now reaches the model with the API's own
  reason instead of a bare "status 400", and a `422` is rendered as
  `field: reason`.

### Added

- `country` on `get_overview`, `get_microconversions`, `get_campaigns`,
  `get_devices`, `get_traffic_mediums` and `get_traffic_sources` — the six tools
  whose endpoint accepted it while the tool did not expose it.
- `landing_page` on `get_top_sources` (which sources brought the sessions that
  entered on one page; the answer comes from the landing-page report and
  therefore carries **no `page_views`**) and on `get_conversions_raw`,
  `get_microconversions_raw` and `get_conversion_items_raw` (multi-value, exact
  match, case-insensitive, trailing slash significant).
- Troubleshooting guide: "a country filter changes nothing, or is rejected" and
  "I filtered by landing page and other landing pages came back".
- Multi-value filters on the three raw tools accept **one value or a list**
  (`landing_page: "/x/"` as well as `landing_page: ["/x/", "/y/"]`); before,
  a bare string was rejected by the schema.

## [1.9.1] — 2026-09-15

### Added — verification timeouts say why (PRD-058 F5)

- `verify_setup` (on a timeout) and `verify_event_instrumented` (when `pending`) read
  `GET /sites/{id}/pixel/rejections` and return `cause` and `rejections`:
  `bot_detected`, `invalid_account` (a site created minutes ago), `blocklist_ip` /
  `blocklist_ua`, `invalid_domain`, `invalid_token` — or nothing logged, which points
  at `t.js` refused (403) on a domain the site does not list, or a missing snippet.
  For an event on a site with traffic, rejections are possible causes, not the verdict. Needs the API with that
  endpoint; against an older API the answer is unchanged.
- Troubleshooting guide: a `204` on `/event` does not mean stored; what each cause
  means.

## [1.9.0] — 2026-09-15

### Added — `plan_install` and `simulate_install` (PRD-058)

- **`plan_install`** validates the install an agent proposes before any file is
  edited and returns a `plan_id` for the user to approve. Findings cover the closed
  taxonomy, PII keys and examples (including `items[].order_id`), revenue that is
  not a number, double or missing pageviews against the snippet's `auto`/`spa`
  flags, the queue stub, domains the site does not list, the 15 KB body limit, an
  existing loader or unplanned calls in `repo_path`, and the snippet URL.
- **`simulate_install`** runs the approved calls through the tracker production
  serves in a local sandbox with no network, and reports what pixel-service would
  store or reject (`invalid_json`, `invalid_account`, `invalid_domain`), with the
  load, SPA-navigation and queue-stub scenarios. A plan changed after approval is
  refused. Results are "simulated, not verified".
- Both are local only (not on the remote transport). `plan_install` is read-only.
  `simulate_install` is **not** declared read-only: it executes the JavaScript it
  is given in `node:vm`, which is not a security boundary, and that hint is what
  lets a client run a tool without asking the user. It still writes nothing and
  reaches no network. Minor version bump at release.

### Added — page-level simulation (PRD-058 F3)

- `simulate_install` with `level: "page"` drives a local browser against the developer's
  dev server and captures every hit to `/event` locally. Checks the tracker tag appears once,
  the tracker loads, no CSP blocks it, no console error comes from it, each expected hit
  arrives once and pageviews match, plus the same payload checks as the call level.
  `tracker_delay_ms` serves the tracker late to test load order.
- `playwright-core` is a new **optional peer** dependency: `npm install`/`npx` does NOT
  pull it, so the package stays the size it was for everyone who never simulates a page
  (13 MB unpacked). Install it next to the MCP server to use `level: "page"`. Without it,
  or without Chrome, Edge or a cached Chromium, the result is `unavailable`. No browser is
  ever downloaded.

### Added — `verify_event_instrumented` checks the row it found (PRD-058 F4)

- New `expect` argument — `value_min`, `value_exact`, `properties_required` — and
  `simulation_id` from a `simulate_install` of the same session, which derives the
  expectation from what the simulation said the server would store.
- New statuses: `mismatch` (the event arrived without revenue, or without a
  property the install sends) and `verified_by_recency` (several recent rows with
  that name and no `value_exact`, so the match may be another visitor's).
  `value_exact` picks the test order's row among real ones.
- `needs_expectation`: a `simulation_id` this session does not hold (the usual
  case after a deploy, in a new conversation) and no `expect` returns this status
  without polling, instead of a `verified` that compared nothing.
- `expect` is validated: an unknown key (`properties` for `properties_required`), a
  value that is not a number, or an amount on a microconversion is an error, not a
  check silently skipped.
- PII is scanned at any depth, including JSON-encoded properties.
- `simulate_install` keeps the last 20 simulations in memory for this.
- Rows fired in the last `lookback_minutes` (default 15) count, by the browser's
  clock. Before, only rows stamped after polling started did, so an event
  triggered before calling the tool was never found.
- A capitalised taxonomy name (`Purchase`) is `rejected` with `not_lowercase`:
  names are stored as sent, so it would never match `purchase`.

### Fixed — `verify_event_instrumented` confirmed microconversions of any name

- Microconversions were queried with `microconversion_type`, which the API
  ignores, and the first recent row was taken whatever its name: any recent
  microconversion confirmed any event. Both routes now filter with
  `conversion_type`, and rows are matched by name.

### Fixed — PII scan in `verify_event_instrumented` helpers

- Product identifiers (`product_id`, `sku`, `ean`, `gtin`…) no longer trip the
  phone-number rule: an EAN-13 was reported as a phone.

## [1.8.2] — 2026-09-14

### Changed — channel-rules read tools work with a normal API key (PRD-055 Bloque A)

- `test_channel_rules`, `list_channel_rules` and `get_channels` now work with
  any key carrying `sites:read` (ticked by default when creating a key). The
  API's `channel-groups` router accepts `sites:read` for its read endpoints;
  until now every API key got 403 there, whatever its scopes, and the tool was
  announced anyway.
- **Remote transport**: `get_channels` and `list_channel_rules` leave
  `REMOTE_EXCLUDED_TOOLS` (`test_channel_rules` was already listed, and
  failing) — the three tools are usable from claude.ai / ChatGPT connections.
  A new test executes every remotely listed tool against a recording client
  and fails if one hits a router gated by the session-only `read` scope.
- **403 errors keep the API's reason** (`Access denied … API said: Required
  scope: one of read, sites:read`), so a model can tell a missing scope from a
  site the key does not cover.
- Troubleshooting guide §3: testing/listing/exporting rules by API works with
  `sites:read`; a 403 naming `Required scope` means the key was created without
  it — create a new key (scopes of an existing key cannot be edited).

### Changed — channel-rule write tools work with an API key (PRD-055 Bloque B)

- `create_channel_rule`, `update_channel_rule`, `delete_channel_rule` and
  `import_channel_rules` now work with a key carrying the new
  `channel_rules:write` scope (drafts). Until now they asked for `write`, a
  scope no API key can carry, so they had never worked with any key.
- The tools stay **draft-only**: even a key with the broader
  `channel_rules:publish` scope creates drafts through the MCP. Publishing
  stays a human action in the dashboard (or a direct API call).
- The 403 scope hint names `channel_rules:write` instead of `write`, and it is
  only applied when the API's own reason starts with `Required scope` — a 403
  about site access is left as it is, so a key that simply does not cover the
  site is no longer reported as a missing scope.
- Troubleshooting guide §3: which scope creates drafts, which one publishes,
  and what a drafts key sees when it tries to publish.

### Fixed — the read-only tools declare all three tool hints

- The remotely listed tools declared `readOnlyHint: true` and nothing else. The
  protocol's defaults for the other two are the opposite of the truth here: an
  undeclared `openWorldHint` means "open internet" and an undeclared
  `destructiveHint` means "irreversible", so tools that only read a customer's
  analytics were announcing themselves to every MCP client as open-world and
  destructive. All three are now declared explicitly, and a test walks the whole
  remote catalogue demanding them. The write and setup tools are untouched: they
  never reach the remote transport, and there the cautious default is the right
  side to err on.

### Changed — click IDs are no longer returned by the raw tools

- `get_conversions_raw` and `get_conversion_items_raw` stop emitting `clid`.
  Sealmetrics no longer stores the value of a click ID anywhere (PRD-041
  RF-020/RF-023) — the API dropped the field, and these tools pass the API's
  JSON through unchanged, so no tool code changed. Attribution by ad platform
  is unaffected: source/medium/campaign and channel group are untouched.

## [1.8.1] — 2026-08-03

### Changed — troubleshooting guide content

- **Section 4 (referrer exclusions)**: clarified that when the excluded domain
  is a login / SSO domain, the residual row is *not* marginal and can be one of
  the largest in Sources. A login sits at the entrance of the app, so visitors
  arriving directly have no earlier session to preserve. Adds how to confirm it
  (`get_top_landing_pages`) and notes that server-side redirects to a login
  serve no page at all, so the tracker cannot run before it.
- **New section 7 (live browser checks)**: how to verify in the browser whether
  the tag actually loads — `t.js`, `POST /event` → `204`, redirect-chain status
  codes, `document.referrer` — with a manual DevTools fallback for hosts without
  browser tools, and warnings that the checks generate real hits and must only
  target a site the user owns.

Content only: no tool or API changes.

## [1.8.0] — 2026-07-30

### Added — live documentation tools

Two new read-only tools that answer product questions from the OFFICIAL docs
site (docs.sealmetrics.com), fetched live so answers never go stale between
npm releases:

- `search_docs` — searches the published documentation index (`llms.txt`,
  cached in memory for 5 minutes) and returns matching pages with title,
  path, and description.
- `get_doc` — reads one documentation page as plain text via the site's
  `/docs-raw/<path>.txt` mirror. Accepts a `search_docs` path or a full
  docs.sealmetrics.com URL (foreign hosts are rejected).

They complement — not replace — `get_troubleshooting_guide` (validated
symptom→cause→fix support answers) and `get_marketing_playbook`: the docs
tools cover reference/how-to content (installation guides, feature docs,
API reference, privacy/GDPR).

## [1.3.0] — 2026-06-27

> **Package renamed** to `@sealmetrics/mcp` (was `@sealmetrics/mcp-server`).
> Update your config to `npx -y @sealmetrics/mcp`.

### Added — write-path (register a site from the chat)

The server now starts **without** `SEALMETRICS_API_KEY` in *setup-only* mode and
can register + verify a SealMetrics site from the chat (e.g. Claude Desktop):

- New setup tools: `provision_site`, `verify_setup`, `get_setup_status`,
  `detect_framework`, `get_instrumentation_guide`, `verify_event_instrumented`.
- **Relaxed startup gate:** with no api key only the setup tools are exposed; the
  ~47 read-only tools stay hidden until a key is present — set in the env, or
  adopted in-session after `provision_site` (`tools/list_changed`). With a key,
  the read-only tools keep full v1.2.0 parity.
- Tools now carry `readOnlyHint` annotations.
- `provision_site` never returns the api key or the claim magic-link to the model.

### Added — Claude Desktop extension (`.mcpb`)

One-click Desktop Extension (`manifest.json` + `npm run pack-mcpb`), with an
**optional** api key: leave it empty to register from the chat, or paste an
existing read-only key for immediate analytics. Self-distributed.

### Added — verified event instrumentation

`verify_event_instrumented` validates the closed taxonomy + rejects PII, then
confirms the event reached the backend via the raw endpoints.

## [1.2.0] — 2026-05-03

### Added — raw event-level tools (PRD 08)

Three new tools exposing the `/stats/{conversions,microconversions,conversion-items}/raw`
API endpoints introduced in PRD 03:

- `get_conversions_raw` — one row per conversion. `properties` is excluded
  by default; pass `include_properties=true` to receive the full object.
- `get_microconversions_raw` — analogous, without `amount`/`clid`.
- `get_conversion_items_raw` — one row per item inside a conversion (e.g.
  product line in a purchase). `properties` is **always** returned because
  that is where `product_id`, `sku`, `price`, `quantity` live.

To keep LLM context budgets in check the raw tools cap `limit` at **100** and
default to **10** (the underlying API permits up to 10000 — that ceiling is
not exposed). Date range remains capped at 31 days by the API.

### Added — multi-value filters and `include` on pages/landing-pages

`get_pages` and `get_landing_pages` accept the new repeated query parameters
introduced by PRD 03:

- Multi-value filters: `country`, `device_type`, `browser`, `os`,
  `channel_group`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`.
  Exposed in the JSON Schema as `array of string` (with `minItems: 1`) and
  serialized to the API as repeated query params (`?country=ES&country=PT`).
- `include` — extra dimensions to add to the GROUP BY. Accepted values:
  `device`, `browser`, `os`, `channel_group`. Exposed as `array` with an
  `enum` so the LLM sees the valid set without round-tripping.

### Changed — tool descriptions

Tool descriptions now include explicit "use this / use that" breadcrumbs so
the LLM picks the right shape on the first try:

- `get_conversions` → suggests the `*_raw` tools for per-event detail.
- `get_microconversions` → suggests `get_microconversions_raw`.
- The 3 new raw tools → cross-link to each other (in particular
  `get_conversion_items_raw` for per-product analysis).

### Breaking — `country` parameter on `get_pages` / `get_landing_pages`

`country` was previously a single `string`. It is now `array of string`
(consistent with the other multi-value filters and with the API contract).
Callers that passed `country: "ES"` must migrate to `country: ["ES"]`.
This is exposed as a minor bump (rather than major) per PRD 08 D-007: the
MCP server has no public versioned contract and the consumers are LLMs
that adapt to the schema on each call.

