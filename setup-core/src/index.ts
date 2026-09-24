/**
 * `@sealmetrics/setup-core` — shared, presentation-agnostic setup logic for the
 * SealMetrics CLI (`sealmetrics`) and MCP server (`@sealmetrics/mcp`).
 *
 * The four headline exports (PRD RF-3101): `detectFramework`, `provision`,
 * `pollPixelStatus`, `getInstrumentationGuide`. Plus the framework-stack guide
 * (RF-3501) and the instrumentation taxonomy/PII validators (RF-3401/3402).
 */
export type {
  Framework,
  Platform,
  Detection,
  ProvisionResult,
  PixelStatus,
} from "./types.js";

// Detection (RF-3101a)
export { detect, detectFramework, detectPlatform, PLATFORM_PLUGIN_HINT } from "./detect/index.js";

// Provisioning + pixel-status HTTP (RF-3101b/c)
export {
  provision,
  fetchPixelStatus,
  buildProvisionBody,
  provisionErrorForStatus,
  unwrapProvisionData,
  ProvisionError,
  PixelStatusError,
} from "./provision.js";
export type {
  ProvisionInput,
  ProvisionOptions,
  PixelStatusOptions,
  ProvisionErrorCode,
} from "./provision.js";

// Rejected hits, to explain a verification timeout (PRD-058 F5)
export { fetchPixelRejections, explainRejections, rejectionWindowMinutes } from "./rejections.js";
export type { PixelRejections, RejectionReasonCount, RejectedOrigin, PixelRejectionsOptions } from "./rejections.js";

// Verification poll loop (RF-3101c / RF-3403)
export { pollPixelStatus } from "./verify.js";
export type { VerifyResult, PollOptions } from "./verify.js";

// Instrumentation guide (RF-3101d)
export {
  INSTRUMENTATION_GUIDE,
  PRIVACY_BANNER,
  buildInstrumentationMarkdown,
  getInstrumentationGuide,
} from "./guide.js";

// Instrumentation taxonomy + PII gate (RF-3401/3402, VAL-3401/3402)
export {
  CONV_TYPES,
  MICRO_TYPES,
  validateEventName,
  detectPII,
  checkInstrumentation,
} from "./instrument.js";
export type {
  ConvType,
  MicroType,
  EventKind,
  TaxonomyResult,
  PiiFinding,
  InstrumentationCheck,
} from "./instrument.js";

// Per-framework loading knowledge (RF-3501/3502)
export {
  getStackGuide,
  STACK_GUIDES,
  getPlatformPluginGuide,
} from "./stack-guide.js";
export type { StackGuide } from "./stack-guide.js";

// Install plan + call-level simulation (PRD-058)
export { planInstall, renderPlanMarkdown, normalizePlan, computePlanId, canonicalJson, parseSnippetUrl, scanRepo, estimateBodyBytes, EVENT_BODY_LIMIT_BYTES } from "./plan/index.js";
export type {
  InstallPlanInput,
  PlanEventInput,
  PropertySpec,
  PlanResult,
  PlanFinding,
  PlanOptions,
  NormalizedPlan,
  Vertical,
  RepoScan,
} from "./plan/index.js";
export { simulateInstall, simulatePage, resolveBrowser, mirrorEvent, MAX_EVENT_BODY_BYTES, TRACKER_STUB } from "./simulate/index.js";
export type {
  SimulateInstallInput,
  SimulateOptions,
  SimulationCase,
  SimulationResult,
  ScenarioName,
  MirrorInput,
  MirrorResult,
  StoredEvent,
  SimulatePageInput,
  PageSimulationResult,
  PageFlow,
  PageStep,
} from "./simulate/index.js";
export { detectPIIDeep } from "./instrument.js";
export { TRACKER_SHA256 } from "./generated/tracker.js";

// Verification expectations (PRD-058 F4)
export {
  compareRow,
  expectationFromStored,
  mergeExpectations,
  pickRow,
  recentRowsFor,
  rowAmount,
  rowProperties,
} from "./verify-expect.js";
export type { EventExpectation, RawEventRow } from "./verify-expect.js";
