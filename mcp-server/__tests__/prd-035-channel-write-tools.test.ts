/**
 * PRD-035 TEST-A10 — MCP channel write tools honor the draft-only invariant:
 * - create_channel_rule ALWAYS posts is_active=false; its schema does not
 *   expose is_active.
 * - update/delete refuse live rules with a clear error; drafts are allowed.
 * - import_channel_rules defaults to dry_run=true, always uses scope=drafts.
 * - a key without the write scope (403 "Required scope") surfaces a clear
 *   scope message naming `channel_rules:write` (PRD-055 RF-B09); a 403 about
 *   site access is NOT remapped into a scope hint.
 * - none of the write tools exposes is_active in its input schema.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SealMetricsClient } from "../src/client.js";
import {
  CHANNEL_WRITE_TOOLS,
  createChannelRuleTool,
  updateChannelRuleTool,
  deleteChannelRuleTool,
  importChannelRulesTool,
  testChannelRulesTool,
} from "../src/tools/channels.js";

const BASE_URL = "http://localhost:9997/api/v1";
const API_KEY = "sm_test_key_prd035";

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
}

let captured: CapturedRequest[] = [];
let ruleIsActive = false;
let ruleIsDefault = false;
let forbidWrites = false;
/** When set, writes answer 403 with this API reason instead of the scope one. */
let forbidWritesReason = "Required scope: one of write, channel_rules:write";

const ruleResponse = () => ({
  success: true,
  data: {
    id: 42,
    account_id: "my-store",
    channel_name: "Paid Social",
    source_pattern: "^fb$",
    medium_pattern: "^cpc$",
    campaign_pattern: null,
    priority: 100,
    is_default: ruleIsDefault,
    is_active: ruleIsActive,
    created_at: "2026-07-16T10:00:00Z",
    updated_at: "2026-07-16T10:00:00Z",
  },
});

const handlers = [
  http.get(`${BASE_URL}/channel-groups/:ruleId`, ({ request }) => {
    captured.push({ method: "GET", url: request.url, body: null });
    return HttpResponse.json(ruleResponse());
  }),
  http.post(`${BASE_URL}/channel-groups`, async ({ request }) => {
    const body = await request.json();
    captured.push({ method: "POST", url: request.url, body });
    if (forbidWrites) {
      // Shape of a real API error (main.py wraps HTTPException like this)
      return HttpResponse.json(
        { error: { code: "forbidden", message: forbidWritesReason } },
        { status: 403 },
      );
    }
    return HttpResponse.json(ruleResponse(), { status: 201 });
  }),
  http.post(`${BASE_URL}/channel-groups/import`, async ({ request }) => {
    const body = await request.json();
    captured.push({ method: "POST", url: request.url, body });
    return HttpResponse.json({
      success: true,
      data: { dry_run: true, scope: "drafts", valid: true, imported: false },
    });
  }),
  http.post(`${BASE_URL}/channel-groups/test`, async ({ request }) => {
    const body = await request.json();
    captured.push({ method: "POST", url: request.url, body });
    return HttpResponse.json({ success: true, data: { channel: "Paid Social", matched_rule: null } });
  }),
  http.patch(`${BASE_URL}/channel-groups/:ruleId`, async ({ request }) => {
    const body = await request.json();
    captured.push({ method: "PATCH", url: request.url, body });
    return HttpResponse.json(ruleResponse());
  }),
  http.delete(`${BASE_URL}/channel-groups/:ruleId`, ({ request }) => {
    captured.push({ method: "DELETE", url: request.url, body: null });
    return new HttpResponse(null, { status: 204 });
  }),
];

const mockServer = setupServer(...handlers);

beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mockServer.resetHandlers();
  captured = [];
  ruleIsActive = false;
  ruleIsDefault = false;
  forbidWrites = false;
  forbidWritesReason = "Required scope: one of write, channel_rules:write";
});
afterAll(() => mockServer.close());

const client = new SealMetricsClient(API_KEY, BASE_URL);

describe("PRD-035 — draft-only invariant", () => {
  it("create_channel_rule always posts is_active=false", async () => {
    await createChannelRuleTool.handler(client, {
      site_id: "my-store",
      channel_name: "Paid Social",
      source_pattern: "^fb$",
      priority: 100,
    });

    const post = captured.find((c) => c.method === "POST")!;
    expect((post.body as Record<string, unknown>).is_active).toBe(false);
  });

  it("no write tool exposes is_active in its input schema", () => {
    for (const tool of CHANNEL_WRITE_TOOLS) {
      expect(
        Object.keys(tool.inputSchema.properties),
        `${tool.name} must not expose is_active`,
      ).not.toContain("is_active");
    }
  });

  it("update_channel_rule refuses a live rule with a clear error", async () => {
    ruleIsActive = true;

    await expect(
      updateChannelRuleTool.handler(client, {
        site_id: "my-store",
        rule_id: 42,
        channel_name: "Other",
      }),
    ).rejects.toThrow(/live — switch it off in the dashboard first/);

    // Only the GET (state check) happened — no PATCH
    expect(captured.map((c) => c.method)).toEqual(["GET"]);
  });

  it("update_channel_rule updates a draft (never sending is_active)", async () => {
    ruleIsActive = false;

    await updateChannelRuleTool.handler(client, {
      site_id: "my-store",
      rule_id: 42,
      priority: 90,
    });

    const patch = captured.find((c) => c.method === "PATCH")!;
    expect(patch).toBeDefined();
    expect(patch.body).toEqual({ priority: 90 });
    // Atomic server-side draft-only guard (TOCTOU fix)
    expect(new URL(patch.url).searchParams.get("only_if_inactive")).toBe("true");
  });

  it("update_channel_rule refuses default system rules", async () => {
    ruleIsDefault = true;

    await expect(
      updateChannelRuleTool.handler(client, { site_id: "my-store", rule_id: 1, priority: 1 }),
    ).rejects.toThrow(/default rule/);
  });

  it("delete_channel_rule refuses a live rule and deletes a draft", async () => {
    ruleIsActive = true;
    await expect(
      deleteChannelRuleTool.handler(client, { site_id: "my-store", rule_id: 42 }),
    ).rejects.toThrow(/live/);
    expect(captured.some((c) => c.method === "DELETE")).toBe(false);

    captured = [];
    ruleIsActive = false;
    const result = await deleteChannelRuleTool.handler(client, {
      site_id: "my-store",
      rule_id: 42,
    });
    expect(captured.some((c) => c.method === "DELETE")).toBe(true);
    expect(result).toMatchObject({ deleted: true, rule_id: 42 });
  });

  it("import_channel_rules defaults to dry_run=true and always scope=drafts", async () => {
    await importChannelRulesTool.handler(client, {
      site_id: "my-store",
      rules: [{ channel_name: "Paid Social", source_pattern: "^fb$", is_active: true }],
    });

    const post = captured.find((c) => c.url.includes("/import"))!;
    const url = new URL(post.url);
    expect(url.searchParams.get("dry_run")).toBe("true");
    expect(url.searchParams.get("scope")).toBe("drafts");
  });

  it("import_channel_rules with dry_run=false still uses scope=drafts", async () => {
    await importChannelRulesTool.handler(client, {
      site_id: "my-store",
      rules: [{ channel_name: "Paid Social", source_pattern: "^fb$" }],
      dry_run: false,
    });

    const url = new URL(captured.find((c) => c.url.includes("/import"))!.url);
    expect(url.searchParams.get("dry_run")).toBe("false");
    expect(url.searchParams.get("scope")).toBe("drafts");
  });

  it("a key without the write scope gets a clear scope error (CHG-015 / RF-B09)", async () => {
    forbidWrites = true;

    await expect(
      createChannelRuleTool.handler(client, {
        site_id: "my-store",
        channel_name: "X",
        source_pattern: "^x$",
      }),
    ).rejects.toThrow(/'channel_rules:write' scope/);
  });

  it("a 403 about site access is not remapped into a scope hint (VAL-B07b)", async () => {
    forbidWrites = true;
    forbidWritesReason = "Access denied to account: my-store";

    await expect(
      createChannelRuleTool.handler(client, {
        site_id: "my-store",
        channel_name: "X",
        source_pattern: "^x$",
      }),
    ).rejects.toThrow(/Access denied/);

    await expect(
      createChannelRuleTool.handler(client, {
        site_id: "my-store",
        channel_name: "X",
        source_pattern: "^x$",
      }),
    ).rejects.not.toThrow(/channel_rules:write/);
  });

  it("test_channel_rules passes include_inactive through", async () => {
    await testChannelRulesTool.handler(client, {
      site_id: "my-store",
      source: "fb",
      medium: "cpc",
      include_inactive: true,
    });

    const post = captured.find((c) => c.url.includes("/test"))!;
    expect(post.body).toEqual({
      source: "fb",
      medium: "cpc",
      campaign: "",
      include_inactive: true,
    });
  });
});

describe("PRD-035 — server registration", () => {
  it("write tools are not registered for the remote transport (omitSetupTools)", async () => {
    const { buildServer } = await import("../src/server.js");
    const remote = buildServer({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      provisionKey: "pk_test",
      version: "0.0.0-test",
      omitSetupTools: true,
    });
    const local = buildServer({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      provisionKey: "pk_test",
      version: "0.0.0-test",
    });

    // Registered tool names live on the server's internal registry; assert via
    // the public handles list length difference (write tools only local).
    // buildServer returns readOnlyHandles only, so compare registered tools maps.
    const remoteNames = Object.keys(
      (remote.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    );
    const localNames = Object.keys(
      (local.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    );

    expect(localNames).toContain("create_channel_rule");
    expect(localNames).toContain("import_channel_rules");
    expect(remoteNames).not.toContain("create_channel_rule");
    expect(remoteNames).not.toContain("import_channel_rules");
    // The read-only tester is available on both
    expect(remoteNames).toContain("test_channel_rules");
  });
});
