/**
 * MCP write-path setup tools (Fase 3 Bloque 2, RF-3203). These let a user register
 * + verify a SealMetrics site **from the chat** (Claude Desktop, no terminal),
 * reusing `@sealmetrics/setup-core` (Bloque 1) so the logic is never duplicated
 * CLI↔MCP. The MCP never edits the user's source (RF-3204) — provision_site hands
 * back the snippet + guide; the agent (with repo) or the human (paste) places it.
 *
 * Privacy/secret handling (VAL-3201/3203, RF-3207):
 *  - provision_site NEVER returns the api_key to the model (it is adopted into
 *    memory to enable the read-only tools and saved by the user via env/email).
 *  - provision_site NEVER returns the claim_url magic-link token (it goes by
 *    email); it returns `claim_email_sent_to` + `dashboard_url` only.
 */
import {
  detectFramework,
  buildProvisionBody,
  unwrapProvisionData,
  provisionErrorForStatus,
  fetchPixelStatus,
  pollPixelStatus,
  getInstrumentationGuide,
  getStackGuide,
  getPlatformPluginGuide,
  checkInstrumentation,
  planInstall,
  simulateInstall,
  simulatePage,
  detectPIIDeep,
  explainRejections,
  fetchPixelRejections,
  rejectionWindowMinutes,
  compareRow,
  expectationFromStored,
  mergeExpectations,
  pickRow,
  recentRowsFor,
  rowProperties,
  type EventExpectation,
  type RawEventRow,
  type StoredEvent,
  type InstallPlanInput,
  type PageFlow,
  type ProvisionInput,
  type SimulationCase,
  type SimulationResult,
  type ScenarioName,
} from "@sealmetrics/setup-core";
import { SealMetricsAPIError } from "../errors.js";
import type { SealMetricsClient } from "../client.js";
import type { SiteListResponse } from "../types.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** What one simulated event stored, and whether the plan declares revenue for it. */
export interface RememberedEvent {
  stored: StoredEvent;
  planDeclaresRevenue: boolean;
}

export interface SetupState {
  provisioned: boolean;
  accountId?: string;
  pixelVerified: boolean;
  /**
   * What each simulate_install run in this session said the server would store, by
   * simulation_id → event name (PRD-058 F4). verify_event_instrumented derives its
   * expectation from it. In memory only; a restarted session starts empty.
   */
  simulations?: Map<string, Map<string, RememberedEvent>>;
}

export interface SetupContext {
  client: SealMetricsClient;
  baseUrl: string;
  provisionKey: string;
  /** install_source attribution (RF-3205). */
  installSource: string;
  /** Project root if the client exposes one (editors); undefined in Desktop chat. */
  cwd?: string;
  state: SetupState;
  /**
   * Called after a successful provision_site so the server adopts the api_key and
   * enables the ~52 read-only tools in the same session (RF-3202b). The api_key is
   * passed here but NEVER returned to the model (VAL-3201).
   */
  onProvisioned: (apiKey: string, accountId: string) => void;
  /** Poll tuning (tests pass small values). Defaults: 2s interval, 25s timeout. */
  pollDefaults?: { intervalMs?: number; timeoutMs?: number };
  /** Injectable clock/sleep for the instrumentation verifier (tests). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Setup tool shape (like ToolDef but the handler closes over the SetupContext). */
export interface SetupToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations: { title: string; readOnlyHint: boolean; openWorldHint?: boolean; destructiveHint?: boolean };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Terms of Service URL — shown so the human can read them before accepting (parity with the CLI). */
const TOS_URL = "https://sealmetrics.com/terms";

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

/** Build the setup tools (RF-3203; plan_install + simulate_install, PRD-058) bound to a context. */
export function createSetupTools(ctx: SetupContext): SetupToolDef[] {
  const provisionSite: SetupToolDef = {
    name: "provision_site",
    description:
      "Register a NEW free SealMetrics site from the chat (no terminal needed). Creates the account, returns the tracker snippet to place in your site's <head>, and emails you a claim link to set a password. After this succeeds, the read-only analytics tools are enabled in this session. Does NOT edit your code — you (or the agent, if it has the repo) place the snippet.",
    inputSchema: {
      type: "object",
      properties: {
        site_name: { type: "string", description: "Human-friendly name for the site (e.g. 'My Shop')." },
        domain: { type: "string", description: "Primary domain of the site (e.g. 'myshop.com'). Optional." },
        email: { type: "string", description: "Your email — receives the claim link to set a password." },
        name: { type: "string", description: "Your name. Optional." },
        accept_terms: {
          type: "boolean",
          description:
            "Must be true: confirms the user has read and accepts the SealMetrics Terms of Service (https://sealmetrics.com/terms). Show the user this link first; do NOT accept on their behalf.",
        },
      },
      required: ["site_name", "email", "accept_terms"],
    },
    annotations: { title: "Provision a Sealmetrics site", readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    handler: async (args) => {
      if (args.accept_terms !== true && args.accept_terms !== "true") {
        throw new Error(
          `accept_terms must be true. Show the user the SealMetrics Terms of Service (${TOS_URL}) and ask them to confirm — do not accept on their behalf.`,
        );
      }
      const siteName = str(args.site_name);
      const email = str(args.email);
      if (!siteName) throw new Error("site_name is required.");
      if (!email) throw new Error("email is required.");

      const input: ProvisionInput = {
        siteName,
        domain: str(args.domain),
        email,
        name: str(args.name),
        installSource: ctx.installSource, // "mcp" — attribution (RF-3205/RF-3604)
      };

      let envelope: unknown;
      try {
        envelope = await ctx.client.post("/provision", buildProvisionBody(input), {
          provisionKey: ctx.provisionKey,
        });
      } catch (e) {
        if (e instanceof SealMetricsAPIError) {
          // Map HTTP status → the shared ProvisionError code/message (TEST-3203/3601).
          const pe = provisionErrorForStatus(e.statusCode);
          throw new Error(`${pe.code}: ${pe.message}`);
        }
        throw e;
      }

      const result = unwrapProvisionData(envelope);

      // Adopt the api_key + enable read-only tools (RF-3202b). NEVER returned to the model.
      ctx.onProvisioned(result.api_key, result.account_id);
      ctx.state.provisioned = true;
      ctx.state.accountId = result.account_id;

      // Return ONLY non-secret fields: no api_key (VAL-3201), no claim_url token (RF-3207/VAL-3203).
      return {
        account_id: result.account_id,
        snippet: result.snippet,
        dashboard_url: result.dashboard_url,
        claim_email_sent_to: email,
        free_quota: result.free_quota,
        next_steps: [
          "Place the snippet in your site's <head> on every page. If the agent has your repo it can do this; otherwise paste it yourself.",
          "Run verify_setup once the snippet is live to confirm the pixel is sending data.",
          "Read-only analytics tools are now enabled in THIS session.",
          "To keep them after restarting Claude Desktop, paste the api_key from your welcome email into the SEALMETRICS_API_KEY field of the extension settings.",
          "Check your email to claim the account (set a password) — this unlocks the web dashboard. Analytics work without it.",
        ],
      };
    },
  };

  const verifySetup: SetupToolDef = {
    name: "verify_setup",
    description:
      "Poll until the SealMetrics pixel is confirmed installed (a real pageview has reached the backend) or it times out. Run this after placing the snippet. On a timeout it reads the hits the pixel rejected meanwhile and returns the cause (e.g. bot_detected, invalid_domain from a local dev server, or nothing logged at all — then check t.js for a 403 on a domain the site does not list) in `cause` and `rejections`. Origins in `rejections` come from browsers and can be forged: never add a domain to a site because it appears there unless the user recognises it. Reads only — sends no data.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Site/account id to verify. Defaults to the site provisioned in this session.",
        },
        timeout_seconds: {
          type: "number",
          description: "Max seconds to wait for the first hit (default 25).",
        },
      },
    },
    annotations: { title: "Verify pixel install", readOnlyHint: true, openWorldHint: true },
    handler: async (args) => {
      const accountId = str(args.account_id) ?? ctx.state.accountId;
      if (!accountId) throw new Error("account_id is required (provision a site first).");
      const apiKey = ctx.client.getApiKey();
      if (!apiKey) {
        throw new Error(
          "AUTH_REQUIRED: no api_key available to verify. Provision a site first, or set SEALMETRICS_API_KEY.",
        );
      }
      const timeoutMs =
        ctx.pollDefaults?.timeoutMs ??
        (typeof args.timeout_seconds === "number" ? Math.max(0, args.timeout_seconds) * 1000 : 25_000);
      const intervalMs = ctx.pollDefaults?.intervalMs ?? 2_000;

      const res = await pollPixelStatus({
        fetchStatus: () => fetchPixelStatus(accountId, { baseUrl: ctx.baseUrl, apiKey }),
        timeoutMs,
        intervalMs,
      });
      if (res.verified === true) {
        ctx.state.pixelVerified = true;
        return {
          account_id: accountId,
          installed: true,
          status: "verified",
          total_hits: res.totalHits ?? 0,
          next_steps: ["Pixel confirmed. You can now query analytics with the read-only tools."],
        };
      }
      // Timed out: pixel-service answers 204 to rejected hits too, so ask why (PRD-058 F5).
      // A skipped poll (timeout 0) asked nothing, so there is nothing to explain.
      const rejections =
        timeoutMs > 0
          ? await fetchPixelRejections(accountId, { baseUrl: ctx.baseUrl, apiKey, minutes: rejectionWindowMinutes(timeoutMs) })
          : null;
      const cause = explainRejections(rejections, "pixel");
      return {
        account_id: accountId,
        installed: false,
        status: "pending",
        total_hits: res.totalHits ?? 0,
        ...(rejections?.available ? { rejections: compactRejections(rejections) } : {}),
        ...(cause ? { cause } : {}),
        next_steps: [
          ...(cause ? [cause] : []),
          "Make sure the snippet is in the <head> of a live page on one of the site's domains, then load that page and re-run verify_setup.",
        ],
      };
    },
  };

  const getSetupStatus: SetupToolDef = {
    name: "get_setup_status",
    description:
      "Report where the setup flow is: whether a site has been provisioned in this session and whether its pixel has been verified.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Setup status", readOnlyHint: true },
    handler: async () => ({
      provisioned: ctx.state.provisioned,
      account_id: ctx.state.accountId,
      pixel_verified: ctx.state.pixelVerified,
    }),
  };

  const detectFrameworkTool: SetupToolDef = {
    name: "detect_framework",
    description:
      "Best-effort detect the web framework/CMS of a project so the snippet can be placed correctly. Pass `path` if you have the repo; in a pure chat (no repo) returns 'unknown' plus the manual guide. Read-only — never edits files.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the project root. Optional; omit if you don't have the repo.",
        },
      },
    },
    annotations: { title: "Detect framework", readOnlyHint: true },
    handler: async (args) => {
      const path = str(args.path) ?? ctx.cwd;
      if (!path) {
        const guide = getStackGuide("unknown");
        return {
          framework: "unknown",
          strategy: "manual",
          location: guide.location,
          placement: guide.placement,
          provision_only: true,
          note: "No project path available (e.g. Claude Desktop chat). Provide `path` if you have the repo, or place the snippet manually using loading_notes.",
          loading_notes: guide.notes,
        };
      }
      const d = detectFramework(path);
      const guide = getStackGuide(d.framework);
      return {
        framework: d.framework,
        platform: d.platform,
        strategy: d.strategy,
        location: d.recommendedLocation,
        placement: d.placementHint,
        provision_only: d.provisionOnly,
        loading_notes: guide.notes,
        ...(d.platform
          ? { plugin_guidance: getPlatformPluginGuide(d.platform, ctx.state.accountId ?? "[YOUR_ACCOUNT_ID]") }
          : {}),
      };
    },
  };

  const getInstrumentationGuideTool: SetupToolDef = {
    name: "get_instrumentation_guide",
    description:
      "Return the canonical SealMetrics event-instrumentation guide (closed conv/micro taxonomy + privacy rules) with your account_id substituted. Use it before writing sealmetrics.conv()/micro() calls. The MCP does NOT write these calls — the agent does, guided by this.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Account id to substitute into the guide. Defaults to the provisioned site.",
        },
      },
    },
    annotations: { title: "Instrumentation guide", readOnlyHint: true },
    handler: async (args) => {
      const accountId = str(args.account_id) ?? ctx.state.accountId ?? "[YOUR_ACCOUNT_ID]";
      return { account_id: accountId, guide: getInstrumentationGuide(accountId) };
    },
  };

  const verifyEventInstrumented: SetupToolDef = {
    name: "verify_event_instrumented",
    description:
      "Close the instrumentation loop: after the user deployed a sealmetrics.conv()/micro() call AND triggered it on the live site, confirm the event reached the backend. Validates the name against the closed taxonomy first, and rejects PII in the stored properties (at any depth). Optionally pass `expect` — value_min, value_exact (a test order with a recognisable total, so only that row counts), properties_required — and/or a `simulation_id` produced earlier in this session, to check the row is the one the install should send: a row without revenue or missing a property returns mismatch. When several recent rows share the name and nothing exact was asked, the status is verified_by_recency, not verified. A simulation_id this session does not hold, with no expect, returns needs_expectation. Rows from the last lookback_minutes (default 15) count, by the time the browser fired them. value_min / value_exact apply to conversions only (microconversions carry no amount). Reads only.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Site/account id. Defaults to the provisioned site." },
        kind: { type: "string", enum: ["conv", "micro"], description: "Event kind: 'conv' or 'micro'." },
        name: { type: "string", description: "Event name (must be in the closed taxonomy, e.g. 'purchase')." },
        timeout_seconds: { type: "number", description: "Max seconds to wait for the event (default 25)." },
        lookback_minutes: { type: "number", description: "How far back a row still counts, by the browser's clock when the event fired (default 15, max 60)." },
        expect: {
          type: "object",
          description: "{ value_min?: number, value_exact?: number, properties_required?: string[] }. value_exact makes only the row with that amount count.",
        },
        simulation_id: { type: "string", description: "simulation_id returned by simulate_install in this session; the expectation is derived from what it stored for this event." },
      },
      required: ["kind", "name"],
    },
    annotations: { title: "Verify instrumented event", readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    handler: async (args) => {
      const accountId = str(args.account_id) ?? ctx.state.accountId;
      if (!accountId) throw new Error("account_id is required (provision a site first).");
      const kind = str(args.kind);
      const name = str(args.name);
      if (kind !== "conv" && kind !== "micro") throw new Error("kind must be 'conv' or 'micro'.");
      if (!name) throw new Error("name is required.");
      if (name !== name.trim().toLowerCase() && checkInstrumentation(kind, name.trim().toLowerCase()).taxonomy.valid) {
        const lower = name.trim().toLowerCase();
        return {
          status: "rejected",
          reason: "not_lowercase",
          name,
          suggestion: lower,
          message: `Event names are stored exactly as sent and the taxonomy is lowercase: sealmetrics.${kind}('${name}') would be reported apart from '${lower}'. Use '${lower}' in the code and here.`,
        };
      }
      const apiKey = ctx.client.getApiKey();
      if (!apiKey) throw new Error("AUTH_REQUIRED: no api_key available. Provision a site first or set SEALMETRICS_API_KEY.");

      // 1) Static gate: taxonomy (VAL-3401). Reject before confirming.
      const check = checkInstrumentation(kind, name);
      if (!check.taxonomy.valid) {
        return {
          status: "rejected",
          reason: "out_of_taxonomy",
          name,
          suggestion: check.taxonomy.suggestion,
          message: `'${name}' is not in the closed ${kind} taxonomy.${check.taxonomy.suggestion ? ` Did you mean '${check.taxonomy.suggestion}'?` : ""} Fix the event name before verifying.`,
        };
      }

      // 2) What the row should look like: the simulation of this session, then the explicit expect.
      const explicit = parseExpectation(args.expect);
      if (kind === "micro" && (explicit?.value_min !== undefined || explicit?.value_exact !== undefined)) {
        throw new Error("expect.value_min / value_exact apply to conversions only: microconversion rows carry no amount.");
      }
      const simulationId = str(args.simulation_id);
      let simulation: "found" | "not_in_session" | "event_not_simulated" | undefined;
      let fromSimulation: EventExpectation | undefined;
      if (simulationId) {
        const events = ctx.state.simulations?.get(simulationId);
        const remembered = events?.get(name);
        simulation = !events ? "not_in_session" : remembered ? "found" : "event_not_simulated";
        if (remembered && remembered.stored.is_micro === (kind === "micro")) {
          fromSimulation = expectationFromStored(remembered.stored, remembered.planDeclaresRevenue);
        }
      }
      const expectation = mergeExpectations(fromSimulation, explicit);
      // Asked to compare with a simulation this session does not hold, and given
      // nothing else: a "verified" here would compare nothing. Say so before polling.
      if (simulationId && simulation !== "found" && !explicit) {
        return {
          status: "needs_expectation",
          account_id: accountId,
          kind,
          name,
          simulation,
          message:
            simulation === "not_in_session"
              ? `Simulation ${simulationId} is not in this session (the server restarted, or it ran in another conversation), so there is nothing to compare the row with. Call again with expect built from the approved plan: properties_required (and value_min / value_exact for a conversion).`
              : `Simulation ${simulationId} has no '${name}' hit, so there is nothing to compare the row with. Call again with expect built from the approved plan.`,
        };
      }

      // 3) Poll the raw endpoint. Both routes filter with `conversion_type`; until
      //    PRD-058 F4 the micro route was sent `microconversion_type`, which the API
      //    ignores — any recent microconversion confirmed any name. Rows are also
      //    filtered by name here, so an ignored filter can never confirm the wrong event.
      const path = kind === "conv" ? "/stats/conversions/raw" : "/stats/microconversions/raw";
      const timeoutMs =
        ctx.pollDefaults?.timeoutMs ??
        (typeof args.timeout_seconds === "number" ? Math.max(0, args.timeout_seconds) * 1000 : 25_000);
      const intervalMs = ctx.pollDefaults?.intervalMs ?? 3_000;

      const startedAt = ctx.now ? ctx.now() : Date.now();
      const deadline = startedAt + timeoutMs;
      const lookbackMinutes =
        typeof args.lookback_minutes === "number" && Number.isFinite(args.lookback_minutes)
          ? Math.min(Math.max(args.lookback_minutes, 1), 60)
          : 15;
      const since = startedAt - lookbackMinutes * 60_000;
      let found: RawEventRow | undefined;
      let recent: RawEventRow[] = [];
      for (;;) {
        try {
          const raw = await ctx.client.requestDirect<{ data?: RawEventRow[] }>(path, {
            site_id: accountId,
            period: "today",
            conversion_type: name,
            page_size: "200",
          });
          recent = recentRowsFor(Array.isArray(raw?.data) ? raw.data : [], name, since);
          found = pickRow(recent, expectation);
        } catch {
          // transient — keep polling until the deadline
        }
        if (found) break;
        const nowMs = ctx.now ? ctx.now() : Date.now();
        if (nowMs + intervalMs >= deadline) break;
        await sleep(intervalMs, ctx.sleep);
      }

      const base = {
        account_id: accountId,
        kind,
        name,
        ...(expectation ? { expectation } : {}),
        ...(simulation ? { simulation } : {}),
      };
      const simulationNote =
        simulation === "not_in_session"
          ? ` Simulation ${simulationId} is not in this session (the server restarted or it ran elsewhere), so the row was not compared with it.`
          : simulation === "event_not_simulated"
            ? ` Simulation ${simulationId} has no '${name}' hit, so the row was not compared with it.`
            : "";
      if (!found) {
        const exactMissing = expectation?.value_exact !== undefined && recent.length > 0;
        const rejections = exactMissing
          ? null
          : await fetchPixelRejections(accountId, { baseUrl: ctx.baseUrl, apiKey, minutes: Math.max(lookbackMinutes, rejectionWindowMinutes(timeoutMs)) });
        const cause = explainRejections(rejections, { event: name });
        return {
          status: "pending",
          ...base,
          ...(rejections?.available ? { rejections: compactRejections(rejections) } : {}),
          ...(cause ? { cause } : {}),
          message: exactMissing
            ? `'${name}' events arrived, but none with amount ${expectation!.value_exact}. Place the test order with that exact total, then re-run.`
            : `No '${name}' ${kind} event in the last ${lookbackMinutes} minutes.${cause ? ` ${cause}` : " Trigger the event (a test visit/action), then re-run. Raw endpoints lag ~2-5s."}`,
        };
      }

      const pii = detectPIIDeep(rowProperties(found));
      if (pii.length > 0) {
        return {
          status: "warning_pii",
          ...base,
          pii_properties: pii.map((f) => ({ reason: f.reason, key: f.key })),
          message: `Event '${name}' arrived, but its properties look like PII (${pii.map((f) => f.key).join(", ")}). Remove personal data / order/user IDs — these must NEVER be tracked.`,
        };
      }

      const mismatches = compareRow(found, expectation);
      if (mismatches.length) {
        return {
          status: "mismatch",
          ...base,
          mismatches,
          message: `Event '${name}' arrived, but not as the install should send it: ${mismatches.join(" ")}`,
        };
      }

      if (expectation?.value_exact === undefined && recent.length > 1) {
        return {
          status: "verified_by_recency",
          ...base,
          recent_rows: recent.length,
          message: `${recent.length} '${name}' events arrived in the last ${lookbackMinutes} minutes, so this one may be a real visitor's, not the test. For a conversion, verify with expect.value_exact and a test order with a recognisable total.${simulationNote}`,
        };
      }
      return {
        status: "verified",
        ...base,
        message: `Event '${name}' confirmed in SealMetrics${expectation ? " as expected" : ""}, with no PII. Instrumentation verified.${simulationNote}`,
      };
    },
  };

  /**
   * Domains of the site from GET /sites (sites:read). `null` when there is no key or
   * the site is not visible: the domain rule is then reported as not checked, never
   * guessed.
   */
  const siteDomains = async (accountId: string): Promise<string[] | null> => {
    if (!ctx.client.getApiKey()) return null;
    try {
      const data = await ctx.client.request<SiteListResponse>("/sites");
      const site = data.sites.find((x) => x.id === accountId);
      return site ? site.domains : null;
    } catch {
      return null;
    }
  };

  const planFromArgs = (args: Record<string, unknown>): InstallPlanInput => {
    const plan = (args.plan && typeof args.plan === "object" ? args.plan : args) as Record<string, unknown>;
    const site = plan.site as { domain?: unknown } | undefined;
    const loader = plan.loader as { snippet_url?: unknown } | undefined;
    const accountId = str(plan.account_id) ?? ctx.state.accountId;
    if (!accountId) throw new Error("account_id is required (provision a site first, or pass it).");
    if (!str(site?.domain)) throw new Error("site.domain is required.");
    if (!str(loader?.snippet_url)) throw new Error("loader.snippet_url is required: the script_tag src from get_tracking_code.");
    if (!Array.isArray(plan.events)) throw new Error("events must be an array of planned events.");
    const repoPath = str(args.repo_path) ?? str(plan.repo_path);
    return { ...(plan as unknown as InstallPlanInput), account_id: accountId, ...(repoPath ? { repo_path: repoPath } : {}) };
  };

  const planInstallTool: SetupToolDef = {
    name: "plan_install",
    description:
      "Validate a Sealmetrics install before any file is edited, and get a plan_id. Takes the loader (the site's snippet_url) and every event: kind conv|micro|pageview, taxonomy name, trigger, value, properties with synthetic examples, plus product_identifier. Returns findings (block/warn/info) for taxonomy, PII (order_id, emails…), revenue that is not a number, double or missing pageviews (auto/spa flags), missing queue stub, domains the site does not list, the 15 KB body limit, an existing loader or unplanned calls in repo_path, and summary_markdown. A blocked status means the plan is not safe to write as it stands; summary_markdown is the human-readable form of the plan, for the person to approve. Reads only.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Site/account id. Defaults to the site provisioned in this session." },
        vertical: { type: "string", enum: ["ecommerce", "hotel", "saas", "leadgen", "content"], description: "Business type; drives funnel and product-identifier rules." },
        repo_path: { type: "string", description: "Absolute path to the site's repository. Optional; enables the existing-loader and unplanned-call checks (read-only scan)." },
        site: { type: "object", description: "{ domain: 'shop.com', framework?: 'next-app' }" },
        loader: { type: "object", description: "{ file: 'app/layout.tsx', snippet_url: '<script src from get_tracking_code>', stub?: boolean, auto_pageview?: boolean, spa_pageview?: boolean }. auto/spa come from the URL (&auto=0, &spa=0); explicit flags that contradict it are a finding." },
        events: {
          type: "array",
          description:
            "[{ kind: 'micro', name: 'add_to_cart', trigger: { type: 'click', where: 'components/AddToCart.tsx' }, properties: { product_id: { source: 'product.id', type: 'string', example: 'SKU-123' } } }, { kind: 'conv', name: 'purchase', value: { source: 'order.total', type: 'number', example: 149.99 }, properties: { currency: {...}, items: { type: 'list', max_items: 20, item: { product_id: 'string', quantity: 'number', price: 'number' } } } }]. A manual pageview is { kind: 'pageview', trigger: { type: 'route' | 'page' }, group? }.",
        },
        product_identifier: { type: "object", description: "{ key: 'product_id', applies_to: ['view_item', 'add_to_cart', 'purchase.items'] }" },
      },
      required: ["site", "loader", "events"],
    },
    annotations: { title: "Plan a Sealmetrics install", readOnlyHint: true, openWorldHint: true, destructiveHint: false },
    handler: async (args) => {
      const plan = planFromArgs(args);
      const domains = await siteDomains(plan.account_id);
      return planInstall(plan, { siteDomains: domains });
    },
  };

  /** Drop the simulator's constant fields (session hash, token, clock) from each captured payload. */
  const compactSimulation = (r: SimulationResult) => ({
    ...r,
    cases: r.cases.map((c) => ({
      ...c,
      hits: c.hits.map((h) => {
        if (!h.payload) return h;
        const { a: _a, s: _s, t: _t, z: _z, c: _c, ...payload } = h.payload;
        return { ...h, payload };
      }),
    })),
  });

  const simulateInstallTool: SetupToolDef = {
    name: "simulate_install",
    description:
      "Run each call of an approved, already-written install through the real Sealmetrics tracker in a local sandbox (no network), and check what pixel-service would store or reject. Takes the approved plan and its plan_id, and one case per event with the call exactly as written (plain JS, types stripped) plus synthetic vars; events without a case are simulated from the plan's examples. Checks: exceptions (sealmetrics is not defined), one hit per action, name and kind, revenue sent as a number, planned properties, PII in the real payload, body size, invalid_json/invalid_account/invalid_domain, product identifier consistency, and the load / SPA navigation / queue-stub scenarios. With level 'page' and the user's dev server running, it instead drives a local browser through the site (base_url on localhost, flows of goto/click/fill/submit steps with expect_hit / expect_pageviews): the snippet as placed, load order, CSP, console errors, a duplicated tag, pageviews per navigation. Every hit is answered locally. If no browser is available it returns status unavailable, with the command that would install one; nothing is installed by this tool. A changed plan returns stale_plan. The result is SIMULATED, not verified: nothing reaches Sealmetrics, and only a real event from the deployed site confirms an install. Local only: it EXECUTES the JavaScript you pass in `cases[].code` on this machine, and at level 'page' drives a browser through the site, so only ever pass code and a base_url the user has agreed to run. It writes no file outside the OS temp dir and sends nothing to Sealmetrics.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object", description: "The approved plan, exactly as passed to plan_install." },
        plan_id: { type: "string", description: "plan_id returned by plan_install for that plan." },
        cases: {
          type: "array",
          description:
            "[{ event: 'purchase', code: \"sealmetrics.conv('purchase', Number(order.total), { currency: order.currency })\", vars: { order: { total: '149.99', currency: 'EUR' } }, source: { file: 'app/checkout/success/page.tsx', line: 42 }, context?: { url?, before_tracker_load? } }]",
        },
        scenarios: {
          type: "array",
          description: "Optional subset of ['load', 'spa_navigation', 'stub_queue', 'iframe']; defaults from the plan.",
        },
        repo_path: { type: "string", description: "Absolute path to the repo; enables the check that each simulated call exists in its source file." },
        level: { type: "string", enum: ["call", "page"], description: "'call' (default): sandbox, no browser. 'page': a local browser against base_url." },
        base_url: { type: "string", description: "level 'page': the dev server, e.g. http://localhost:3000. Loopback only unless allow_remote_url." },
        allow_remote_url: { type: "boolean", description: "level 'page': drive a non-local URL. Only with the user's explicit confirmation." },
        flows: {
          type: "array",
          description:
            "level 'page': [{ event: 'add_to_cart', steps: [{ goto: '/products/tee', expect_pageviews: 1 }, { click: 'button[data-testid=add-to-cart]', expect_hit: { e: 'add_to_cart', m: true } }] }]. Steps: goto, click, fill { selector, value }, submit (form selector), wait_ms, expect_hit { e?, m? } (no e = a pageview), expect_pageviews.",
        },
        tracker_source: { type: "string", enum: ["vendored", "cdn"], description: "level 'page': 'vendored' (default) serves the production tracker locally; 'cdn' loads the real one, which answers 403 to domains the site does not list." },
        tracker_delay_ms: { type: "number", description: "level 'page': serve the tracker this late, to test load order." },
      },
      required: ["plan", "plan_id"],
    },
    // NOT readOnlyHint: the tool runs the agent-written `cases[].code` in node:vm,
    // which is not a security boundary (see sandbox.ts) — an escape reaches the
    // process, its env (SEALMETRICS_API_KEY) and the shell — and at level "page" it
    // drives a browser through a site. Declaring it read-only is what lets a client
    // auto-approve it without asking the user, so it is declared as a tool that acts.
    // It still writes nothing outside the OS temp dir and sends nothing to Sealmetrics.
    annotations: { title: "Simulate a Sealmetrics install", readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    handler: async (args) => {
      const plan = planFromArgs(args);
      const planId = str(args.plan_id);
      if (!planId) throw new Error("plan_id is required: call plan_install first and get the user's approval.");
      if (args.level === "page") {
        const baseUrl = str(args.base_url);
        if (!baseUrl) throw new Error("base_url is required for level 'page': the local dev server, e.g. http://localhost:3000.");
        const page = await simulatePage({
          plan,
          plan_id: planId,
          base_url: baseUrl,
          allow_remote_url: args.allow_remote_url === true,
          tracker_source: args.tracker_source === "cdn" ? "cdn" : "vendored",
          tracker_delay_ms: typeof args.tracker_delay_ms === "number" ? args.tracker_delay_ms : undefined,
          flows: Array.isArray(args.flows) ? (args.flows as PageFlow[]) : [],
          // Screenshots of failed flows go to the OS temp dir, never into the user's repo.
          screenshot_dir: join(tmpdir(), "sealmetrics-simulations"),
        });
        rememberSimulation(ctx.state, page.simulation_id, plan, passingFirst(page.flows).flatMap((f) => f.hits).map((h) => h.stored_as));
        return page;
      }
      const domains = await siteDomains(plan.account_id);
      const result = simulateInstall(
        {
          plan,
          plan_id: planId,
          cases: Array.isArray(args.cases) ? (args.cases as SimulationCase[]) : undefined,
          scenarios: Array.isArray(args.scenarios) ? (args.scenarios as ScenarioName[]) : undefined,
        },
        { siteDomains: domains },
      );
      rememberSimulation(ctx.state, result.simulation_id, plan, passingFirst(result.cases).flatMap((c) => c.hits).map((h) => h.stored_as));
      return compactSimulation(result);
    },
  };

  return [
    provisionSite,
    verifySetup,
    getSetupStatus,
    detectFrameworkTool,
    getInstrumentationGuideTool,
    verifyEventInstrumented,
    planInstallTool,
    simulateInstallTool,
  ];
}

// Local helpers ---------------------------------------------------------------

function sleep(ms: number, custom?: (ms: number) => Promise<void>): Promise<void> {
  if (custom) return custom(ms);
  return new Promise((r) => setTimeout(r, ms));
}

const MAX_REMEMBERED_SIMULATIONS = 20;

/** Counts and origins only, as the API returns them, without the echoed account id. */
const compactRejections = (r: { window_minutes: number; accepted: number; rejected: number; reasons: unknown[] }) => ({
  window_minutes: r.window_minutes,
  accepted: r.accepted,
  rejected: r.rejected,
  reasons: r.reasons,
});

const passingFirst = <T extends { verdict: string }>(runs: T[]): T[] => [
  ...runs.filter((r) => r.verdict === "pass"),
  ...runs.filter((r) => r.verdict !== "pass"),
];

/**
 * Keep what a simulation stored per event name (first hit of a passing case or flow
 * wins), newest simulation last, capped.
 */
function rememberSimulation(state: SetupState, simulationId: string | null, plan: InstallPlanInput, stored: (StoredEvent | undefined)[]): void {
  if (!simulationId) return;
  const planEvents = Array.isArray(plan.events) ? (plan.events as { kind?: unknown; name?: unknown; value?: unknown }[]) : [];
  const events = new Map<string, RememberedEvent>();
  for (const s of stored) {
    if (!s || !s.conversion_type || events.has(s.conversion_type)) continue;
    const planDeclaresRevenue = planEvents.some((e) => e && e.kind === "conv" && e.name === s.conversion_type && !!e.value);
    events.set(s.conversion_type, { stored: s, planDeclaresRevenue });
  }
  state.simulations ??= new Map();
  state.simulations.delete(simulationId);
  state.simulations.set(simulationId, events);
  while (state.simulations.size > MAX_REMEMBERED_SIMULATIONS) {
    state.simulations.delete(state.simulations.keys().next().value as string);
  }
}

/** `expect` as an object or a JSON string; numbers may come as numeric strings. Invalid input throws. */
function parseExpectation(value: unknown): EventExpectation | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      throw new Error("expect must be an object: { value_min?, value_exact?, properties_required? }.");
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("expect must be an object: { value_min?, value_exact?, properties_required? }.");
  }
  const o = v as Record<string, unknown>;
  // An unknown key would otherwise be dropped and the row "verified" without the
  // check the agent meant (a real run sent `properties` for `properties_required`).
  const unknown = Object.keys(o).filter((k) => !["value_min", "value_exact", "properties_required"].includes(k));
  if (unknown.length) {
    throw new Error(`Unknown key${unknown.length > 1 ? "s" : ""} in expect: ${unknown.join(", ")}. Use value_min, value_exact and properties_required.`);
  }
  const num = (key: string): number | undefined => {
    const raw = o[key];
    if (raw === undefined || raw === null) return undefined;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(n)) throw new Error(`expect.${key} must be a number, got ${JSON.stringify(raw)}.`);
    return n;
  };
  const out: EventExpectation = {};
  const min = num("value_min");
  const exact = num("value_exact");
  if (min !== undefined) out.value_min = min;
  if (exact !== undefined) out.value_exact = exact;
  if (o.properties_required !== undefined) {
    if (!Array.isArray(o.properties_required)) throw new Error("expect.properties_required must be an array of property keys.");
    out.properties_required = o.properties_required.map(String);
  }
  return Object.keys(out).length ? out : undefined;
}
