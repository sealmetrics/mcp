/**
 * `planInstall` (PRD-058 B). Turns the install an agent proposes into a validated,
 * hashed plan the user approves before any code is written. Reads the repository
 * when `repo_path` is given; never writes anything (RF-3204).
 */
import { normalizePlan, computePlanId } from "./normalize.js";
import { scanRepo } from "./repo.js";
import { RULES, loaderFlagFindings } from "./rules.js";
import { EVENT_BODY_LIMIT_BYTES, estimateBodyBytes } from "./size.js";
import type { InstallPlanInput, NormalizedPlan, PlanFinding, PlanOptions, PlanResult, Severity } from "./types.js";

const ORDER: Record<Severity, number> = { block: 0, warn: 1, info: 2 };

const looksLikeFile = (s: string) => /[\\/]/.test(s) && /\.[a-z0-9]{1,6}$/i.test(s) && !/\s/.test(s);

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderPlanMarkdown(plan: NormalizedPlan, planId: string): string {
  const l = plan.loader;
  const rows = [
    "| Event | Kind | Trigger | Where | Properties | Revenue |",
    "|---|---|---|---|---|---|",
    `| pageview | ${l.auto_pageview ? "auto on load" : "manual"}${l.spa_pageview ? " + SPA navigations" : ""} | load | ${cell(l.file ?? "(snippet)")} | ${l.group ? `group=${cell(l.group)}` : "—"} | — |`,
    ...plan.events.map((e) => {
      const props = Object.entries(e.properties)
        .map(([k, s]) => (s.item ? `${k}[] (${Object.keys(s.item).join(", ")})` : k))
        .join(", ");
      return `| ${e.kind === "pageview" ? "pageview" : `\`${e.name}\``} | ${e.kind} | ${e.trigger?.type ?? "—"} | ${cell(e.trigger?.where ?? "—")} | ${cell(props || (e.group ? `group=${e.group}` : "—"))} | ${e.value ? cell(e.value.source ?? "yes") : "—"} |`;
    }),
  ];
  const loaderLine = `Loader: \`${l.snippet_url}\` (auto=${l.auto_pageview ? 1 : 0}, spa=${l.spa_pageview ? 1 : 0}${l.stub ? ", queue stub in <head>" : ""}).`;
  return [`**Install plan \`${planId}\`** — ${plan.site.domain}${plan.vertical ? ` · ${plan.vertical}` : ""}`, "", loaderLine, "", ...rows].join("\n");
}

export function planInstall(input: InstallPlanInput, options: PlanOptions = {}): PlanResult {
  const plan = normalizePlan(input);
  const plan_id = computePlanId(plan);
  const repo = input.repo_path ? scanRepo(input.repo_path) : null;

  const findings: PlanFinding[] = [
    ...loaderFlagFindings(input.loader ?? {}, plan),
    ...RULES.flatMap((rule) => rule(plan, { options, repo })),
  ].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.code.localeCompare(b.code));

  if (repo?.truncated) {
    findings.push({ code: "PL-13", severity: "info", event: "repo", message: `Repository scan stopped after ${repo.files_scanned} files; PL-13 and PL-14 may be incomplete.` });
  }

  const files = new Set<string>();
  if (plan.loader.file) files.add(plan.loader.file);
  for (const e of plan.events) if (e.trigger?.where && looksLikeFile(e.trigger.where)) files.add(e.trigger.where);

  const sizes = plan.events.filter((e) => e.kind !== "pageview").map((e) => estimateBodyBytes(plan, e));
  const blocked = findings.some((f) => f.severity === "block");

  return {
    plan_id,
    status: blocked ? "blocked" : "ok",
    findings,
    plan,
    summary_markdown: renderPlanMarkdown(plan, plan_id),
    files_to_edit: [...files],
    estimate: {
      events: plan.events.length,
      max_payload_bytes: sizes.length ? Math.max(...sizes) : 0,
      payload_limit_bytes: EVENT_BODY_LIMIT_BYTES,
    },
    checked: { site_domains: Array.isArray(options.siteDomains), repo: repo !== null },
    next_step: blocked
      ? "Fix every block finding and call plan_install again. Do not show a blocked plan to the user as a proposal."
      : "Show summary_markdown and the warn findings to the user and wait for explicit approval in their own words. Do not edit files until then; after approval, pass this plan and plan_id to simulate_install.",
  };
}

export { normalizePlan, computePlanId, canonicalJson, parseSnippetUrl } from "./normalize.js";
export { scanRepo, fileHasCall } from "./repo.js";
export type { RepoScan, RepoCall } from "./repo.js";
export { EVENT_BODY_LIMIT_BYTES, EVENT_BODY_WARN_BYTES, estimateBodyBytes, exampleProperties } from "./size.js";
export * from "./types.js";
