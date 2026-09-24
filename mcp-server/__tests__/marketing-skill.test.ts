/**
 * PRD mcp-marketing-skill — TEST-MKT01/02/03.
 *
 *  - TEST-MKT01: the generated CONTENT is non-empty, references only real tools,
 *    uses only valid `period` presets, and the committed `.ts` is in sync with the
 *    canonical `.md` (single source — Decisión 7).
 *  - TEST-MKT02: `get_marketing_playbook` is exposed (with api_key) and returns the
 *    playbook CONTENT; it is hidden without an api_key (inherits the read-only gate).
 *  - TEST-MKT03: the `sealmetrics://marketing-guide` resource is listed and reads
 *    back the same CONTENT.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { VALID_PERIODS } from "../src/types.js";
import {
  MARKETING_GUIDE_CONTENT,
  MARKETING_GUIDE_URI,
} from "../src/resources/marketing-guide.js";
import { generateModule, MD_PATH, TS_PATH } from "../scripts/gen-marketing-guide.mjs";

const TOOL_NAME = "get_marketing_playbook";
const VALID_PERIOD_SET = new Set<string>(VALID_PERIODS as readonly string[]);
const TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));

/** Period-shaped backtick tokens we care about validating against the enum. */
const PERIOD_SHAPE = /^(today|yesterday|\d+d|\d+m|wtd|mtd|qtd|ytd|this_\w+|last_\w+)$/;
/**
 * Invalid presets the playbook deliberately cites as "do NOT use" counter-examples
 * (e.g. "there is no `last_30_days` — use `30d`"). Allowlisted by exact token, not by
 * skipping whole lines, so a *new* invalid preset still fails even on a negation line.
 */
const KNOWN_COUNTEREXAMPLES = new Set(["last_30_days", "last_7_days"]);

async function connect(apiKey?: string) {
  const { server } = buildServer({
    apiKey,
    baseUrl: "http://localhost:9999/api/v1",
    provisionKey: "pk_mcp_test",
    version: "test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "test" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("TEST-MKT01: content is valid and in sync with the .md", () => {
  it("CONTENT is non-empty", () => {
    expect(MARKETING_GUIDE_CONTENT.length).toBeGreaterThan(1000);
  });

  it("references only tools that exist in ALL_TOOLS", () => {
    const referenced = MARKETING_GUIDE_CONTENT.match(/\b(?:get|list)_[a-z_]+/g) ?? [];
    const unknown = [...new Set(referenced)]
      .filter((name) => !name.endsWith("_")) // drop globs like `get_top_*`
      .filter((name) => !TOOL_NAMES.has(name));
    expect(unknown, `unknown tools referenced: ${unknown.join(", ")}`).toEqual([]);
  });

  it("uses only valid `period` presets (negation lines excepted)", () => {
    const offenders: string[] = [];
    const tokens = MARKETING_GUIDE_CONTENT.match(/`([a-z0-9_]+)`/g) ?? [];
    for (const raw of tokens) {
      const token = raw.slice(1, -1);
      if (!PERIOD_SHAPE.test(token)) continue;
      if (VALID_PERIOD_SET.has(token)) continue;
      if (KNOWN_COUNTEREXAMPLES.has(token)) continue; // documented "do not use" examples
      offenders.push(token);
    }
    expect([...new Set(offenders)], `invalid period literals: ${offenders.join(", ")}`).toEqual([]);
  });

  it("committed marketing-guide.ts matches what the codegen produces from the .md", () => {
    const md = readFileSync(MD_PATH, "utf8");
    const expected = generateModule(md);
    const actual = readFileSync(TS_PATH, "utf8");
    expect(actual).toBe(expected);
  });
});

describe("TEST-MKT02: get_marketing_playbook tool gating + handler", () => {
  it("is registered in ALL_TOOLS and returns the playbook CONTENT", async () => {
    const def = ALL_TOOLS.find((t) => t.name === TOOL_NAME);
    expect(def).toBeDefined();
    const result = (await def!.handler({} as never, {})) as { playbook: string };
    expect(result.playbook).toBe(MARKETING_GUIDE_CONTENT);
  });

  it("appears in tools/list WITH an api_key", async () => {
    const { client } = await connect("sm_test_key");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain(TOOL_NAME);
  });

  it("is hidden from tools/list WITHOUT an api_key", async () => {
    const { client } = await connect(undefined);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain(TOOL_NAME);
  });

  it("invoked via the connected client returns the CONTENT", async () => {
    const { client } = await connect("sm_test_key");
    const res = (await client.callTool({ name: TOOL_NAME, arguments: {} })) as {
      content: { type: string; text: string }[];
    };
    expect(res.content[0].text).toContain("Marketing Performance Skill");
  });
});

describe("TEST-MKT03: marketing-guide resource", () => {
  it("is listed and reads back the CONTENT", async () => {
    const { client } = await connect("sm_test_key");
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain(MARKETING_GUIDE_URI);

    const read = await client.readResource({ uri: MARKETING_GUIDE_URI });
    expect(read.contents[0].text).toBe(MARKETING_GUIDE_CONTENT);
    expect(read.contents[0].mimeType).toBe("text/markdown");
  });
});
