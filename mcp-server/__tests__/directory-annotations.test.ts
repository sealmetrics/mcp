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
