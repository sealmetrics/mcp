/**
 * Why a verification found nothing (PRD-058 F5). pixel-service answers 204 to every
 * hit, stored or not; GET /sites/{id}/pixel/rejections says how many were rejected in
 * a recent window, why, and from which page origins. Shared by the MCP verifiers and
 * the CLI, which call it only after a poll timed out.
 */

export interface RejectedOrigin {
  origin: string;
  count: number;
}

export interface RejectionReasonCount {
  reason: string;
  count: number;
  origins: RejectedOrigin[];
}

export interface PixelRejections {
  account_id: string;
  window_minutes: number;
  /** false when the API could not read the hit log: counts are unknown, not zero. */
  available: boolean;
  accepted: number;
  rejected: number;
  reasons: RejectionReasonCount[];
}

export interface PixelRejectionsOptions {
  baseUrl: string;
  apiKey: string;
  minutes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** The window to ask for after a poll of `pollTimeoutMs`: the poll plus 15 minutes, 15 to 1440. */
export const rejectionWindowMinutes = (pollTimeoutMs: number): number =>
  Math.min(1440, Math.max(15, Math.ceil(pollTimeoutMs / 60_000) + 15));

/**
 * GET /sites/{id}/pixel/rejections. Never throws: an older API without the endpoint,
 * a network error or an unexpected body is `null`, and the caller keeps its own message.
 */
export async function fetchPixelRejections(accountId: string, options: PixelRejectionsOptions): Promise<PixelRejections | null> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const minutes = Math.min(1440, Math.max(1, Math.round(options.minutes ?? 15)));
  const url = `${base}/sites/${encodeURIComponent(accountId)}/pixel/rejections?minutes=${minutes}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { "X-API-Key": options.apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (res.status !== 200) return null;
    const json = JSON.parse(await res.text()) as { data?: unknown };
    return parseRejections(json?.data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseRejections(data: unknown): PixelRejections | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.rejected !== "number" || !Array.isArray(d.reasons)) return null;
  return {
    account_id: String(d.account_id ?? ""),
    window_minutes: Number(d.window_minutes ?? 0),
    available: d.available !== false,
    accepted: Number(d.accepted ?? 0),
    rejected: d.rejected,
    reasons: (d.reasons as Record<string, unknown>[]).map((r) => ({
      reason: String(r.reason ?? "unknown"),
      count: Number(r.count ?? 0),
      origins: Array.isArray(r.origins)
        ? (r.origins as Record<string, unknown>[]).map((o) => ({ origin: String(o.origin ?? ""), count: Number(o.count ?? 0) }))
        : [],
    })),
  };
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[^/]+\.local|[^/]+\.localhost)(:\d+)?$/i;
const PREVIEW_ORIGIN = /\.(vercel\.app|netlify\.app|pages\.dev|ngrok(-free)?\.app|ngrok\.io|onrender\.com|herokuapp\.com)(:\d+)?$/i;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What pixel-service does before any hit is logged: `t.js` answers 403 to a page whose
 * Referer domain the site does not list, so on localhost, a preview or a mistyped
 * domain the tracker never runs and nothing is rejected — there is nothing to reject.
 * A new site also needs up to 5 minutes before the pixel knows it (cache refresh).
 */
const SILENT_CAUSES =
  "Check the browser's Network panel for t.js: a 403 means the page's domain is not one of the site's domains (localhost, a preview URL, or a site saved as www.example.com, which rejects every hit — save it without www.). A site created in the last 5 minutes is not known to the pixel yet: wait and reload.";

function reasonSentence(r: RejectionReasonCount): string {
  const origins = r.origins.map((o) => o.origin).filter(Boolean);
  // Origins come from the hit itself, which anyone can forge: they describe, never instruct.
  const from = origins.length ? ` from ${origins.slice(0, 3).join(", ")}` : "";
  const n = plural(r.count, "hit");
  switch (r.reason) {
    case "invalid_domain": {
      if (!origins.length) {
        return `${n} rejected as invalid_domain from a page without an http(s) address (a local file, about:blank) — open the page from the site itself.`;
      }
      const local = origins.some((o) => LOCAL_ORIGIN.test(o));
      const preview = origins.some((o) => PREVIEW_ORIGIN.test(o));
      const why = local
        ? "a local dev server is not one of the site's domains, so its hits are never stored: verify on the live site"
        : preview
          ? "a preview or staging deploy is not one of the site's domains: verify on the live site"
          : "that domain is not one of the site's domains. If it is the user's own site, add it to the site; a site saved as www.example.com rejects every hit, so save it without www. Never add a domain the user does not recognise: origins are reported by the browser and can be forged";
      return `${n} rejected as invalid_domain${from} — ${why}.`;
    }
    case "invalid_account":
      return `${n} rejected as invalid_account${from} — the pixel does not know the site as active: it was created less than 5 minutes ago (wait and reload), or it is deactivated.`;
    case "invalid_token":
      return `${n} rejected as invalid_token${from} — the tracker token did not validate: the page runs a cached or copied tracker instead of loading t.js as given; clear the page or CDN cache.`;
    case "blocklist_ip":
      return `${n} rejected as blocklist_ip${from} — the visitor IP is excluded, by the site's IP exclusions (often the office or the tester's own IP) or by Sealmetrics' global IP blocklists: test from another connection (a mobile network, for instance).`;
    case "blocklist_ua":
      return `${n} rejected as blocklist_ua${from} — the browser's user agent is excluded (headless and automated browsers are): test in a normal browser.`;
    case "bot_detected":
      return `${n} rejected as bot_detected${from} — the session sent many pageviews within seconds (repeated reloads, hot reload, or fast route changes) and is blocked for up to an hour: wait, or test in another browser or profile, and navigate at a normal pace.`;
    default:
      return `${n} rejected as ${r.reason}${from}.`;
  }
}

/**
 * A plain-language cause for a verification that found nothing, or `null` when the
 * rejections could not be read. `subject` is "pixel" (no pageview stored) or an
 * event name (the pixel may be fine, the event did not arrive).
 */
export function explainRejections(r: PixelRejections | null, subject: "pixel" | { event: string }): string | null {
  if (!r || !r.available) return null;
  const window = `the last ${r.window_minutes} minutes`;
  const reasons = r.reasons.map(reasonSentence).join(" ");

  if (subject === "pixel") {
    if (r.accepted > 0) {
      return `${plural(r.accepted, "hit")} from this site were stored in ${window}: the pixel works now; run the verification again.`;
    }
    if (r.rejected === 0) {
      return `No hit from this site was stored or rejected in ${window}: the tracker has not sent anything. Check that the snippet is in the <head> of the deployed page (not only in the local code). ${SILENT_CAUSES}`;
    }
    return `No hit was stored in ${window}, and ${plural(r.rejected, "hit")} were rejected: ${reasons}`;
  }

  const event = subject.event;
  if (r.accepted > 0) {
    // The tracker runs. Rejections here may be other visitors' (crawlers, blocklists),
    // so they are possible causes, never the verdict.
    const base = `The tracker runs (${plural(r.accepted, "hit")} stored in ${window}), so either the '${event}' call did not fire on the live site, or fired under another name`;
    return r.rejected > 0
      ? `${base}, or its hit was rejected. ${plural(r.rejected, "hit")} were rejected meanwhile, possibly other visitors': ${reasons}`
      : `${base}. Nothing was rejected.`;
  }
  if (r.rejected === 0) {
    return `No hit from this site was stored or rejected in ${window}: the tracker has not run on the live site, so '${event}' could not arrive either. ${SILENT_CAUSES}`;
  }
  return `No hit was stored in ${window}, and ${plural(r.rejected, "hit")} were rejected: ${reasons}`;
}
