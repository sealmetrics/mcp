/**
 * Call-level sandbox (PRD-058 C1). Runs the tracker production serves
 * (`generated/tracker.ts`, synced from pixel-service tracker.go) in a fresh
 * `node:vm` context with the smallest DOM it touches, and captures every beacon /
 * fetch instead of sending it. Deterministic: fixed clock, UA, screen, timezone.
 *
 * `node:vm` is NOT a security boundary. This runs in the local MCP, with the user's
 * privileges, on code the agent just wrote into the user's own repository — the
 * trust level of running their tests. The remote transport never registers it.
 */
import vm from "node:vm";
import { TRACKER_CODE } from "../generated/tracker.js";

export const SIM_ENDPOINT = "https://sim.invalid";
export const SIM_NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
export const SIM_TOKEN = Buffer.from(`${Math.floor(SIM_NOW / 1000)}:${"0".repeat(32)}`).toString("base64url");
export const SIM_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const RUN_TIMEOUT_MS = 1000;

/** The queue stub from tracker/CLAUDE.md ("Buffer stub"). Its markers are a public contract. */
export const TRACKER_STUB =
  "!function(w){w.sealmetrics=w.sealmetrics||function(){(w.sealmetrics.q=w.sealmetrics.q||[]).push(['pv',arguments])};w.sealmetrics.q=w.sealmetrics.q||[];w.sealmetrics.conv=w.sealmetrics.conv||function(){w.sealmetrics.q.push(['cv',arguments])};w.sealmetrics.micro=w.sealmetrics.micro||function(){w.sealmetrics.q.push(['mc',arguments])}}(window);";

/** Port of `sanitizeJSString` (pixel-service/internal/handler/sanitize.go). */
export function sanitizeJSString(s: string): string {
  s = s.split("\x00").join("");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") out += "\\\\";
    else if (ch === "'") out += "\\'";
    else if (ch === '"') out += '\\"';
    else if (ch === "`") out += "\\`";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "<" && s[i + 1] === "/") {
      out += "<\\/";
      i++;
    } else out += ch;
  }
  return out;
}

export interface TrackerFlags {
  accountId: string;
  group: string;
  auto: boolean;
  spa: boolean;
}

/** `TrackerHandler.buildScript`: every placeholder through sanitizeJSString. */
export function buildTrackerScript(flags: TrackerFlags, template = TRACKER_CODE): string {
  return template
    .split("{{ACCOUNT_ID}}").join(sanitizeJSString(flags.accountId))
    .split("{{TOKEN}}").join(sanitizeJSString(SIM_TOKEN))
    .split("{{GROUP}}").join(sanitizeJSString(flags.group))
    .split("{{ENDPOINT}}").join(sanitizeJSString(SIM_ENDPOINT))
    .split("{{AUTO}}").join(flags.auto ? "1" : "0")
    .split("{{SPA}}").join(flags.spa ? "1" : "0");
}

export interface CapturedHit {
  seq: number;
  url: string;
  body: string;
  transport: "beacon" | "fetch";
  /** Label of the step that produced it (`load`, `case`, `navigate:2`…). */
  phase: string;
}

export interface TrackerCall {
  fn: "conv" | "micro" | "pageview";
  /** `typeof` of each argument, and its value when it is a primitive. */
  args: { type: string; value?: unknown }[];
  phase: string;
}

export interface RunError {
  message: string;
  line?: number;
  phase: string;
}

export interface PageOptions {
  url: string;
  referrer?: string;
  title?: string;
  /** Render inside an iframe: `window.top !== window.self`. */
  iframe?: boolean;
  timezone?: string;
}

export interface SimPage {
  hits: CapturedHit[];
  calls: TrackerCall[];
  errors: RunError[];
  setPhase(phase: string): void;
  /** Run a snippet; errors are recorded, never thrown. */
  run(code: string, filename: string): boolean;
  /** Define globals from JSON-safe values, created inside the context's realm. */
  defineVars(vars: Record<string, unknown>): void;
  loadTracker(flags: TrackerFlags): boolean;
  /** Record the arguments of calls made to the loaded tracker from now on. */
  watchCalls(): void;
  /** Arguments queued in the stub before the tracker loaded. */
  queuedCalls(): TrackerCall[];
  pushState(url: string): void;
  /** Browser back: the URL changes, then `popstate` fires. */
  back(url: string): void;
  href(): string;
}

const describeArg = (v: unknown) =>
  v === null || ["string", "number", "boolean", "undefined"].includes(typeof v)
    ? { type: v === null ? "null" : typeof v, value: v }
    : { type: Array.isArray(v) ? "array" : typeof v };

export function createPage(opts: PageOptions): SimPage {
  let href = new URL(opts.url).href;
  let phase = "load";
  let seq = 0;
  const hits: CapturedHit[] = [];
  const calls: TrackerCall[] = [];
  const errors: RunError[] = [];
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};

  const capture = (transport: CapturedHit["transport"]) => (url: unknown, init?: unknown) => {
    const body = transport === "beacon" ? init : (init as { body?: unknown } | undefined)?.body;
    hits.push({ seq: seq++, url: String(url), body: body == null ? "" : String(body), transport, phase });
    return transport === "beacon" ? true : Promise.resolve({ ok: true, status: 204, headers: { get: () => null } });
  };

  const location = {
    get href() { return href; },
    set href(v: string) { href = new URL(String(v), href).href; },
    get pathname() { return new URL(href).pathname; },
    get hostname() { return new URL(href).hostname; },
    get search() { return new URL(href).search; },
    toString() { return href; },
  };
  const history = {
    length: 1,
    state: null as unknown,
    pushState(state: unknown, _title: unknown, url?: unknown) {
      if (url != null) href = new URL(String(url), href).href;
      this.state = state;
      this.length++;
    },
    replaceState(state: unknown, _title: unknown, url?: unknown) {
      if (url != null) href = new URL(String(url), href).href;
      this.state = state;
    },
  };

  const g: Record<string, unknown> = {
    location,
    history,
    document: {
      referrer: opts.referrer ?? "",
      title: opts.title ?? "",
      readyState: "complete",
      cookie: "",
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
    },
    navigator: {
      userAgent: SIM_USER_AGENT,
      language: "es-ES",
      languages: ["es-ES", "es", "en"],
      hardwareConcurrency: 8,
      deviceMemory: 8,
      webdriver: false,
      sendBeacon: capture("beacon"),
    },
    screen: { width: 1440, height: 900, colorDepth: 24 },
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
    fetch: capture("fetch"),
    URLSearchParams,
    URL,
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: opts.timezone ?? "Europe/Madrid" }) }) },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener(type: string, fn: (ev: unknown) => void) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
  };
  g.window = g;
  g.self = g;
  g.top = opts.iframe ? {} : g;
  g.globalThis = g;

  const context = vm.createContext(g);
  vm.runInContext(`Date.now = function () { return ${SIM_NOW}; };`, context);

  const run = (code: string, filename: string): boolean => {
    try {
      new vm.Script(code, { filename }).runInContext(context, { timeout: RUN_TIMEOUT_MS });
      return true;
    } catch (e) {
      const err = e as { message?: unknown; stack?: unknown };
      const stack = typeof err?.stack === "string" ? err.stack : "";
      const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const line = new RegExp(`${escaped}:(\\d+)`).exec(stack)?.[1];
      errors.push({ message: String(err?.message ?? e), line: line ? Number(line) : undefined, phase });
      return false;
    }
  };

  return {
    hits,
    calls,
    errors,
    setPhase(p) { phase = p; },
    run,
    defineVars(vars) {
      for (const [name, value] of Object.entries(vars)) {
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
          errors.push({ message: `invalid variable name '${name}'`, phase });
          continue;
        }
        run(`globalThis[${JSON.stringify(name)}] = JSON.parse(${JSON.stringify(JSON.stringify(value ?? null))});`, "vars.js");
      }
    },
    loadTracker(flags) {
      return run(buildTrackerScript(flags), "t.js");
    },
    watchCalls() {
      const api = g.sealmetrics as ((...a: unknown[]) => unknown) & Record<string, (...a: unknown[]) => unknown>;
      if (typeof api !== "function" || typeof api.conv !== "function") return;
      const record = (fn: TrackerCall["fn"], original: (...a: unknown[]) => unknown) =>
        function (this: unknown, ...a: unknown[]) {
          calls.push({ fn, args: a.map(describeArg), phase });
          return original.apply(this, a);
        };
      const wrapped = record("pageview", api) as unknown as Record<string, unknown>;
      wrapped.conv = record("conv", api.conv);
      wrapped.micro = record("micro", api.micro);
      for (const k of ["sessionId", "accountId", "tz", "autoMode", "spaMode"]) wrapped[k] = api[k];
      g.sealmetrics = wrapped;
    },
    queuedCalls() {
      const q = (g.sealmetrics as { q?: unknown[] } | undefined)?.q;
      if (!Array.isArray(q)) return [];
      const fnOf: Record<string, TrackerCall["fn"]> = { cv: "conv", mc: "micro", pv: "pageview" };
      return q
        .filter((entry): entry is [string, ArrayLike<unknown>] => Array.isArray(entry) && typeof entry[0] === "string")
        .map(([marker, args]) => ({ fn: fnOf[marker] ?? "pageview", args: Array.from(args ?? []).map(describeArg), phase }));
    },
    pushState(url) {
      run(`history.pushState({}, "", ${JSON.stringify(url)});`, "navigate.js");
    },
    back(url) {
      href = new URL(url, href).href;
      for (const fn of listeners.popstate ?? []) {
        try {
          fn({ type: "popstate", state: null });
        } catch (e) {
          errors.push({ message: String((e as Error)?.message ?? e), phase });
        }
      }
    },
    href: () => href,
  };
}
