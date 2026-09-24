/**
 * PRD-029 TEST-010 — MCP `get_channels` passes `period` through as-is.
 *
 * Before the fix the tool pre-resolved the preset to start_date/end_date in the
 * Node process's UTC clock (`periodToDateRange`). Now it forwards `period`
 * verbatim and the API resolves it in the account's timezone. This test asserts
 * the outgoing request to `/channel-groups/stats/channels` carries `period` and
 * NOT `start_date`/`end_date`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SealMetricsClient } from "../src/client.js";

const BASE_URL = "http://localhost:9998/api/v1";
const API_KEY = "sm_test_key_channels";

let lastRequestUrl = "";

const handlers = [
  http.get(`${BASE_URL}/channel-groups/stats/channels`, ({ request }) => {
    lastRequestUrl = request.url;
    return HttpResponse.json({ success: true, data: { channels: [] } });
  }),
];

const mockServer = setupServer(...handlers);

beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mockServer.resetHandlers();
  lastRequestUrl = "";
});
afterAll(() => mockServer.close());

describe("PRD-029 — get_channels period pass-through", () => {
  const client = new SealMetricsClient(API_KEY, BASE_URL);

  it("TEST-010: forwards `period` and omits start_date/end_date", async () => {
    const { getChannelsTool } = await import("../src/tools/channels.js");
    await getChannelsTool.handler(client, { site_id: "my-store", period: "today" });

    const url = new URL(lastRequestUrl);
    expect(url.searchParams.get("period")).toBe("today");
    expect(url.searchParams.has("start_date")).toBe(false);
    expect(url.searchParams.has("end_date")).toBe(false);
    expect(url.searchParams.get("account_id")).toBe("my-store");
  });

  it("TEST-010b: defaults to 30d when no period is given", async () => {
    const { getChannelsTool } = await import("../src/tools/channels.js");
    await getChannelsTool.handler(client, { site_id: "my-store" });

    const url = new URL(lastRequestUrl);
    expect(url.searchParams.get("period")).toBe("30d");
    expect(url.searchParams.has("start_date")).toBe(false);
  });
});
