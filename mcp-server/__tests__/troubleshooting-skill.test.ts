/**
 * Troubleshooting skill (support FAQ distilled from validated resolutions).
 * Mirrors marketing-skill.test.ts:
 *
 *  - TEST-TRB01: the generated CONTENT is non-empty, references only real tools,
 *    and the committed `.ts` is in sync with the canonical `.md` (single source).
 *  - TEST-TRB02: `get_troubleshooting_guide` is exposed (with api_key) and returns
 *    the guide CONTENT; it is hidden without an api_key (read-only gate).
 *  - TEST-TRB03: the `sealmetrics://troubleshooting-guide` resource is listed and
 *    reads back the same CONTENT.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import {
  TROUBLESHOOTING_GUIDE_CONTENT,
  TROUBLESHOOTING_GUIDE_URI,
} from "../src/resources/troubleshooting-guide.js";
import { generateModule, MD_PATH, TS_PATH } from "../scripts/gen-troubleshooting-guide.mjs";

const TOOL_NAME = "get_troubleshooting_guide";
const TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));

/**
 * Setup tools live outside ALL_TOOLS (tools/setup.ts, built per-context by
 * createSetupTools) but are legitimate references for the guide.
 */
const SETUP_TOOL_NAMES = new Set([
  "provision_site",
  "verify_setup",
  "get_setup_status",
  "detect_framework",
  "get_instrumentation_guide",
  "verify_event_instrumented",
]);

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

describe("TEST-TRB01: content is valid and in sync with the .md", () => {
  it("CONTENT is non-empty", () => {
    expect(TROUBLESHOOTING_GUIDE_CONTENT.length).toBeGreaterThan(1000);
  });

  it("references only tools that exist (ALL_TOOLS or setup tools)", () => {
    const referenced = TROUBLESHOOTING_GUIDE_CONTENT.match(/\b(?:get|list)_[a-z_]+/g) ?? [];
    const unknown = [...new Set(referenced)]
      .filter((name) => !name.endsWith("_")) // drop globs like `get_top_*`
      .filter((name) => !TOOL_NAMES.has(name) && !SETUP_TOOL_NAMES.has(name));
    expect(unknown, `unknown tools referenced: ${unknown.join(", ")}`).toEqual([]);
  });

  it("committed troubleshooting-guide.ts matches what the codegen produces from the .md", () => {
    const md = readFileSync(MD_PATH, "utf8");
    const expected = generateModule(md);
    const actual = readFileSync(TS_PATH, "utf8");
    expect(actual).toBe(expected);
  });
});

describe("TEST-TRB02: get_troubleshooting_guide tool gating + handler", () => {
  it("is registered in ALL_TOOLS and returns the guide CONTENT", async () => {
    const def = ALL_TOOLS.find((t) => t.name === TOOL_NAME);
    expect(def).toBeDefined();
    const result = (await def!.handler({} as never, {})) as { guide: string };
    expect(result.guide).toBe(TROUBLESHOOTING_GUIDE_CONTENT);
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
    expect(res.content[0].text).toContain("SealMetrics Troubleshooting Guide");
  });
});

describe("TEST-TRB03: troubleshooting-guide resource", () => {
  it("is listed and reads back the CONTENT", async () => {
    const { client } = await connect("sm_test_key");
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain(TROUBLESHOOTING_GUIDE_URI);

    const read = await client.readResource({ uri: TROUBLESHOOTING_GUIDE_URI });
    expect(read.contents[0].text).toBe(TROUBLESHOOTING_GUIDE_CONTENT);
    expect(read.contents[0].mimeType).toBe("text/markdown");
  });
});
