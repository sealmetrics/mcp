/**
 * Edge rate limiting for the remote transport (RF-RMT41).
 *
 * Fixed-window counters per OAuth token (hashed) and per client IP, backed by
 * Redis so limits hold across replicas (no in-memory-per-replica state — the
 * balneospa lesson). When Redis is not configured (local dev) it degrades to an
 * in-process window with a warning.
 *
 * The `redis` package is a devDependency loaded lazily: the published npm
 * package (stdio entrypoint) never imports this module's Redis path.
 */
import { createHash } from "node:crypto";

interface RedisLike {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfter: number;
}

export interface RateLimiterOptions {
  redisUrl?: string;
  /** Requests per minute per token. */
  tokenLimit: number;
  /** Requests per minute per IP. */
  ipLimit: number;
  keyPrefix?: string;
}

const WINDOW_SECONDS = 60;

export class RateLimiter {
  private redis: RedisLike | null = null;
  private redisFailed = false;
  private readonly memory = new Map<string, { count: number; resetAt: number }>();
  private readonly opts: Required<Pick<RateLimiterOptions, "tokenLimit" | "ipLimit">> &
    RateLimiterOptions;

  constructor(opts: RateLimiterOptions) {
    this.opts = { keyPrefix: "sm:mcp:rl", ...opts };
  }

  /** Connect to Redis if configured. Safe to call once at boot. */
  async init(): Promise<void> {
    if (!this.opts.redisUrl) {
      console.error(
        "[mcp-remote] REDIS_URL not set — rate limiting falls back to per-process memory (dev only)",
      );
      return;
    }
    try {
      const { createClient } = (await import("redis")) as {
        createClient: (o: { url: string }) => {
          connect(): Promise<unknown>;
          on(event: string, cb: (err: unknown) => void): unknown;
        } & RedisLike;
      };
      const client = createClient({ url: this.opts.redisUrl });
      client.on("error", (err) => {
        if (!this.redisFailed) {
          this.redisFailed = true;
          console.error(`[mcp-remote] redis error: ${String(err)}`);
        }
      });
      await client.connect();
      this.redis = client;
      this.redisFailed = false;
    } catch (err) {
      console.error(`[mcp-remote] redis unavailable, using memory fallback: ${String(err)}`);
    }
  }

  /** Check both the per-token and per-IP windows. Fail-open on Redis errors. */
  async check(token: string | undefined, ip: string): Promise<RateLimitDecision> {
    const checks: Array<{ key: string; limit: number }> = [
      { key: `${this.opts.keyPrefix}:ip:${ip}`, limit: this.opts.ipLimit },
    ];
    if (token) {
      const tokenHash = createHash("sha256").update(token).digest("hex").slice(0, 32);
      checks.push({ key: `${this.opts.keyPrefix}:tok:${tokenHash}`, limit: this.opts.tokenLimit });
    }

    for (const { key, limit } of checks) {
      const decision = await this.checkOne(key, limit);
      if (!decision.allowed) return decision;
    }
    return { allowed: true, retryAfter: 0 };
  }

  private async checkOne(key: string, limit: number): Promise<RateLimitDecision> {
    if (this.redis) {
      try {
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, WINDOW_SECONDS);
        if (count > limit) {
          const ttl = await this.redis.ttl(key);
          return { allowed: false, retryAfter: ttl > 0 ? ttl : WINDOW_SECONDS };
        }
        return { allowed: true, retryAfter: 0 };
      } catch {
        // Redis hiccup — fail open rather than dropping legitimate traffic.
        return { allowed: true, retryAfter: 0 };
      }
    }
    return this.checkMemory(key, limit);
  }

  private checkMemory(key: string, limit: number): RateLimitDecision {
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
      if (this.memory.size > 10_000) this.pruneMemory(now);
      return { allowed: true, retryAfter: 0 };
    }
    entry.count += 1;
    if (entry.count > limit) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  private pruneMemory(now: number): void {
    for (const [key, entry] of this.memory) {
      if (entry.resetAt <= now) this.memory.delete(key);
    }
  }
}
