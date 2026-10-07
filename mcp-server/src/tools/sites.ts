import type { SealMetricsClient } from "../client.js";
import type { SiteListResponse } from "../types.js";
import { resolveSiteId, SITE_ID_SCHEMA } from "./shared.js";
import type { ToolDef } from "./index.js";

export const listSitesTool: ToolDef = {
  name: "list_sites",
  description:
    "List the sites (web properties) this connection can read. Returns each site's ID, name and domains; the ID is the site_id the report tools take.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  handler: async (client: SealMetricsClient) => {
    const data = await client.request<SiteListResponse>("/sites");
    return data.sites.map((s) => ({
      site_id: s.id,
      name: s.name,
      domains: s.domains,
      timezone: s.timezone,
    }));
  },
};

export const getSiteTool: ToolDef = {
  name: "get_site",
  description:
    "Get detailed information about one site: name, domains, timezone, configuration and tracking status.",
  inputSchema: {
    type: "object" as const,
    properties: {
      site_id: SITE_ID_SCHEMA,
    },
  },
  handler: async (client: SealMetricsClient, args: Record<string, unknown>) => {
    const siteId = resolveSiteId(args);
    return client.request<unknown>(`/sites/${encodeURIComponent(siteId)}`);
  },
};
