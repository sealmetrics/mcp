/**
 * Connectors Directory review (PRD mcpb-directory-listing, RF-DIR04): every
 * tool the local server exposes carries a `title` and, when it is not
 * read-only, an EXPLICIT `destructiveHint`. The MCP default for an undeclared
 * destructiveHint is `true`, so leaving it out mislabels additive writes.
 *
 * Honest values, tool by tool:
 * - provision_site, create_channel_rule, simulate_install: additive → false.
 * - update_channel_rule, delete_channel_rule, import_channel_rules (replaces
 *   the site's drafts when dry_run=false): overwrite or remove → true.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";

async function listLocalTools() {
  const { server } = buildServer({
    apiKey: "sm_test_key_directory",
    baseUrl: "http://localhost:9996/api/v1",
    provisionKey: "pk_mcp_test",
    version: "test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "test" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  return tools;
}

const EXPECTED_DESTRUCTIVE: Record<string, boolean> = {
  provision_site: false,
  create_channel_rule: false,
  simulate_install: false,
  update_channel_rule: true,
  delete_channel_rule: true,
  import_channel_rules: true,
};

describe("tool annotations for the Connectors Directory", () => {
  it("every tool declares a title and a name of at most 64 characters", async () => {
    const tools = await listLocalTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.annotations?.title, tool.name).toBeTruthy();
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(64);
    }
  });

  it("every non-read-only tool declares destructiveHint explicitly", async () => {
    const tools = await listLocalTools();
    const writes = tools.filter((tool) => tool.annotations?.readOnlyHint !== true);
    expect(writes.map((tool) => tool.name).sort()).toEqual(Object.keys(EXPECTED_DESTRUCTIVE).sort());
    for (const tool of writes) {
      expect(tool.annotations?.destructiveHint, tool.name).toBe(EXPECTED_DESTRUCTIVE[tool.name]);
    }
  });
});

/**
 * Directory compliance: the submission form asks the publisher to confirm that
 * tool descriptions carry no instructions about model behaviour, other tools or
 * external instruction sources. PR #409 cleaned the remote tools; this pins the
 * same bar for every tool the local extension exposes, which is what the
 * Desktop Extensions form submits.
 */
describe("tool descriptions carry no instructions", () => {
  it("no description names another tool", async () => {
    const tools = await listLocalTools();
    const names = tools.map((tool) => tool.name);
    const offenders: string[] = [];
    for (const tool of tools) {
      const others = names.filter((name) => name !== tool.name && tool.description?.includes(name));
      if (others.length) offenders.push(`${tool.name} → ${others.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no description steers the model", async () => {
    const tools = await listLocalTools();
    const steering =
      /call this (first|whenever)|call it (first|again)|use \`?[a-z_]+\`? (first|instead)|best tool for|you should|always call|wait for explicit|ask the user before|tell the user to/i;
    const offenders = tools
      .filter((tool) => steering.test(tool.description ?? ""))
      .map((tool) => `${tool.name} → ${steering.exec(tool.description ?? "")?.[0]}`);
    expect(offenders).toEqual([]);
  });
});

/**
 * The mirror published at github.com/sealmetrics/mcp is generated from this
 * tree, so anything written here becomes public on the next sync. Two things
 * must never travel: a path inside the private monorepo (a dead link for the
 * reader, and in a user-facing message it advertises an unfixed defect), and a
 * usable provision key for an environment reachable from the internet.
 */
describe("nothing that only makes sense inside the monorepo is published", () => {
  it("no tool or parameter description points at a private path", async () => {
    const tools = await listLocalTools();
    const privatePath = /docs\/prd\/|CLAUDE\.md|api\/src\/sealmetrics_api|github\.com\/adinton/;
    const offenders = tools
      .filter((tool) => privatePath.test(JSON.stringify([tool.description, tool.inputSchema])))
      .map((tool) => tool.name);
    expect(offenders).toEqual([]);
  });

  it("the auto-used provision key covers localhost only", async () => {
    const { isNonProdTarget } = await import("../src/embedded.js");
    expect(isNonProdTarget("http://localhost:8001/api/v1")).toBe(true);
    expect(isNonProdTarget("http://127.0.0.1:8001/api/v1")).toBe(true);
    // Any deployed host needs SEALMETRICS_PROVISION_KEY instead, so this file
    // carries no usable key for anything reachable from the internet.
    expect(isNonProdTarget("https://my.sealmetrics.com/api/v1")).toBe(false);
    expect(isNonProdTarget("https://staging.example.com/api/v1")).toBe(false);
  });
});
