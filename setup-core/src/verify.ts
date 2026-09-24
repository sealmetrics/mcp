/**
 * Pixel-verification poll loop (Bloque 6 / RF-3403 base). Presentation- and
 * transport-agnostic: it takes an injected `fetchStatus` thunk and reports
 * transient errors through an optional `onError` callback instead of a Reporter.
 * The CLI wraps it with its `ApiClient` + NDJSON reporter; the MCP wraps it with
 * {@link fetchPixelStatus} + the api_key. Capped exponential backoff so we never
 * hammer the backend (VAL-601).
 */
import type { PixelStatus } from "./types.js";

export interface VerifyResult {
  /** true=confirmed, false=timed out, null=skipped (timeoutMs <= 0). */
  verified: boolean | null;
  totalHits?: number;
}

export interface PollOptions {
  /** One-shot status fetch (e.g. () => fetchPixelStatus(id, {baseUrl, apiKey})). */
  fetchStatus: () => Promise<PixelStatus>;
  timeoutMs: number;
  intervalMs?: number;
  maxIntervalMs?: number;
  /** Notified (not thrown) on a transient fetch error mid-poll. */
  onError?: (e: unknown) => void;
  /** Injectable clock/sleep for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll until `installed` is true or the deadline passes. First check is immediate.
 * A transient error keeps retrying until the deadline (it never aborts the loop).
 */
export async function pollPixelStatus(opts: PollOptions): Promise<VerifyResult> {
  if (opts.timeoutMs <= 0) {
    return { verified: null };
  }

  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = now() + opts.timeoutMs;
  let interval = opts.intervalMs ?? 3000;
  const maxInterval = opts.maxIntervalMs ?? 10_000;

  for (;;) {
    let installed = false;
    let totalHits = 0;
    try {
      const status = await opts.fetchStatus();
      installed = status.installed;
      totalHits = status.total_hits;
    } catch (e) {
      // Transient backend error mid-poll: keep trying until the deadline.
      opts.onError?.(e);
    }

    if (installed) {
      return { verified: true, totalHits };
    }

    if (now() + interval >= deadline) {
      return { verified: false, totalHits };
    }

    await sleep(interval);
    interval = Math.min(Math.floor(interval * 1.5), maxInterval);
  }
}
