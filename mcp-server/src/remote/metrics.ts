/**
 * Prometheus metrics for the remote transport (RF-RMT42).
 *
 * Hand-rolled text exposition (counters + one duration histogram) to keep the
 * published npm package dependency-free. Served on a separate internal port —
 * never behind the public Traefik router.
 */

const LATENCY_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class Metrics {
  private readonly requestsTotal = new Map<string, number>();
  private readonly authFailures = { invalid_token: 0, missing_token: 0, introspection_error: 0 };
  private rateLimited = 0;
  private toolCallsTotal = 0;
  // PRD-043 RF-009: how connections are shaped, no per-account cardinality.
  private readonly grantTypes = { single: 0, multi: 0, all: 0 };
  private readonly latencyBuckets = new Array<number>(LATENCY_BUCKETS.length + 1).fill(0);
  private latencySum = 0;
  private latencyCount = 0;

  recordRequest(method: string, path: string, status: number): void {
    const key = `${method}|${path}|${status}`;
    this.requestsTotal.set(key, (this.requestsTotal.get(key) ?? 0) + 1);
  }

  recordAuthFailure(reason: keyof Metrics["authFailures"]): void {
    this.authFailures[reason] += 1;
  }

  recordRateLimited(): void {
    this.rateLimited += 1;
  }

  recordToolCall(): void {
    this.toolCallsTotal += 1;
  }

  recordGrantType(type: keyof Metrics["grantTypes"]): void {
    this.grantTypes[type] += 1;
  }

  recordLatency(seconds: number): void {
    this.latencySum += seconds;
    this.latencyCount += 1;
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      if (seconds <= LATENCY_BUCKETS[i]) {
        this.latencyBuckets[i] += 1;
        return;
      }
    }
    this.latencyBuckets[LATENCY_BUCKETS.length] += 1;
  }

  /** Render Prometheus text exposition format (version 0.0.4). */
  render(): string {
    const lines: string[] = [];

    lines.push("# HELP mcp_remote_requests_total HTTP requests handled by the remote MCP transport");
    lines.push("# TYPE mcp_remote_requests_total counter");
    for (const [key, value] of this.requestsTotal) {
      const [method, path, status] = key.split("|");
      lines.push(
        `mcp_remote_requests_total{method="${method}",path="${path}",status="${status}"} ${value}`,
      );
    }

    lines.push("# HELP mcp_remote_auth_failures_total Rejected Bearer authentications");
    lines.push("# TYPE mcp_remote_auth_failures_total counter");
    for (const [reason, value] of Object.entries(this.authFailures)) {
      lines.push(`mcp_remote_auth_failures_total{reason="${reason}"} ${value}`);
    }

    lines.push("# HELP mcp_remote_rate_limited_total Requests rejected by the edge rate limiter");
    lines.push("# TYPE mcp_remote_rate_limited_total counter");
    lines.push(`mcp_remote_rate_limited_total ${this.rateLimited}`);

    lines.push("# HELP mcp_remote_tool_calls_total MCP tools/call requests served");
    lines.push("# TYPE mcp_remote_tool_calls_total counter");
    lines.push(`mcp_remote_tool_calls_total ${this.toolCallsTotal}`);

    lines.push(
      "# HELP mcp_remote_grant_types_total Authenticated requests by OAuth grant shape (PRD-043)",
    );
    lines.push("# TYPE mcp_remote_grant_types_total counter");
    for (const [type, value] of Object.entries(this.grantTypes)) {
      lines.push(`mcp_remote_grant_types_total{type="${type}"} ${value}`);
    }

    lines.push("# HELP mcp_remote_request_duration_seconds Request duration for POST /mcp");
    lines.push("# TYPE mcp_remote_request_duration_seconds histogram");
    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      cumulative += this.latencyBuckets[i];
      lines.push(`mcp_remote_request_duration_seconds_bucket{le="${LATENCY_BUCKETS[i]}"} ${cumulative}`);
    }
    cumulative += this.latencyBuckets[LATENCY_BUCKETS.length];
    lines.push(`mcp_remote_request_duration_seconds_bucket{le="+Inf"} ${cumulative}`);
    lines.push(`mcp_remote_request_duration_seconds_sum ${this.latencySum}`);
    lines.push(`mcp_remote_request_duration_seconds_count ${this.latencyCount}`);

    return lines.join("\n") + "\n";
  }
}
