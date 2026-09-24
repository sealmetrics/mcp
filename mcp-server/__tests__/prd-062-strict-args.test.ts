/**
 * PRD-062 TEST-005 (RF-030 / DEC-04): tools reject arguments they do not declare.
 *
 * A `z.object(shape)` drops unknown keys, so `get_overview(country="Spain")`
 * used to run unfiltered and let the model report a filter it never applied.
 * Now the call comes back as a tool error listing the accepted arguments, and
 * the published JSON Schema says `additionalProperties: false`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, unknownArgumentsError } from "../src/server.js";
import { createOpenAICompatTools } from "../src/remote/openai-tools.js";

const BASE_URL = "http://localhost:9987/api/v1";
const API_KEY = "sm_test_prd062";

let apiCalls: string[] = [];

const mockServer = setupServer(
  http.get(`${BASE_URL}/stats/*`, ({ request }) => {
    apiCalls.push(request.url);
    return HttpResponse.json({ success: true, data: {} });
  }),
);

beforeAll(() => mockServer.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => mockServer.close());

async function connect() {
  const { server } = buildServer({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    provisionKey: "pk_mcp_test",
    version: "test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "test" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

describe("unknownArgumentsError", () => {
  const properties = { site_id: {}, period: {} };

  it("returns null when every argument is declared", () => {
    expect(unknownArgumentsError("get_overview", properties, { period: "7d" })).toBeNull();
  });

  it("names the offending argument and the accepted ones", () => {
    expect(unknownArgumentsError("get_overview", properties, { foo: 1 })).toBe(
      'Unknown argument "foo" for get_overview. Accepted: site_id, period.',
    );
  });

  it("lists several unknown arguments at once", () => {
    const message = unknownArgumentsError("get_overview", properties, { foo: 1, bar: 2 });
    expect(message).toBe(
      'Unknown arguments "foo", "bar" for get_overview. Accepted: site_id, period.',
    );
  });
});

describe("TEST-005: an undeclared argument is a tool error, not a silent drop", () => {
  it("get_overview with foo=1 errors and lists the accepted arguments", async () => {
    const client = await connect();
    apiCalls = [];
    const result = (await client.callTool({
      name: "get_overview",
      arguments: { site_id: "demo-site", foo: 1 },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown argument "foo" for get_overview');
    expect(result.content[0].text).toContain("Accepted: site_id");
    // The point of the fix: no request went out pretending to be filtered.
    expect(apiCalls).toHaveLength(0);
  });

  it("landing_page on a tool that does not support it is rejected", async () => {
    const client = await connect();
    apiCalls = [];
    const result = (await client.callTool({
      name: "get_top_channels",
      arguments: { site_id: "demo-site", landing_page: "/x/" },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown argument "landing_page"');
    expect(apiCalls).toHaveLength(0);
  });

  it("a declared argument still goes through", async () => {
    const client = await connect();
    apiCalls = [];
    const result = (await client.callTool({
      name: "get_overview",
      arguments: { site_id: "demo-site", period: "7d" },
    })) as ToolResult;

    expect(result.isError).toBeFalsy();
    expect(apiCalls).toHaveLength(1);
  });

  it("every listed tool publishes additionalProperties: false", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(40);
    for (const tool of tools) {
      expect(
        (tool.inputSchema as { additionalProperties?: unknown }).additionalProperties,
        `${tool.name} must forbid extra arguments`,
      ).toBe(false);
    }
  });
});

describe("TEST-005 (remote): the ChatGPT-compat tools get the same treatment", () => {
  it("search rejects an undeclared argument", async () => {
    // The remote entrypoint registers search/fetch through the same
    // buildServer pipeline, so it inherits strictness — assert it anyway,
    // because they declare their own inputSchema (PRD-062 note).
    const { server } = buildServer({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      provisionKey: "pk_mcp_test",
      version: "test",
      omitSetupTools: true,
      extraReadOnlyTools: createOpenAICompatTools({ dashboardUrl: "https://x", accountId: "s" }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "test" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = (await client.callTool({
      name: "search",
      arguments: { query: "conversions", country: "Spain" },
    })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown argument "country" for search');
  });
});
