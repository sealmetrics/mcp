import { describe, it, expect } from "vitest";
import { pollPixelStatus } from "../src/verify.js";
import type { PixelStatus } from "../src/types.js";

const status = (installed: boolean, total = 0): PixelStatus => ({
  account_id: "acc",
  installed,
  first_hit_at: null,
  last_hit_at: null,
  total_hits: total,
});

const noSleep = () => Promise.resolve();

describe("pollPixelStatus (TEST-3101)", () => {
  it("polls false→true and returns verified with totalHits", async () => {
    const seq = [status(false), status(true, 3)];
    let i = 0;
    const res = await pollPixelStatus({
      fetchStatus: async () => seq[Math.min(i++, seq.length - 1)],
      timeoutMs: 30_000,
      intervalMs: 5,
      sleep: noSleep,
    });
    expect(res.verified).toBe(true);
    expect(res.totalHits).toBe(3);
  });

  it("timeoutMs <= 0 → skipped (verified null)", async () => {
    const res = await pollPixelStatus({
      fetchStatus: async () => status(true),
      timeoutMs: 0,
    });
    expect(res.verified).toBe(null);
  });

  it("never installs → verified false at deadline", async () => {
    let t = 0;
    const res = await pollPixelStatus({
      fetchStatus: async () => status(false),
      timeoutMs: 20,
      intervalMs: 5,
      now: () => (t += 5),
      sleep: noSleep,
    });
    expect(res.verified).toBe(false);
  });

  it("tolerates a transient error mid-poll via onError, then succeeds", async () => {
    let i = 0;
    const errors: unknown[] = [];
    const res = await pollPixelStatus({
      fetchStatus: async () => {
        if (i++ === 0) throw new Error("boom");
        return status(true);
      },
      timeoutMs: 30_000,
      intervalMs: 5,
      sleep: noSleep,
      onError: (e) => errors.push(e),
    });
    expect(res.verified).toBe(true);
    expect(errors).toHaveLength(1);
  });
});
