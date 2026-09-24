/**
 * Server factory (Fase 3 Bloque 2). Builds the McpServer, registers the ~47
 * read-only data tools (with `readOnlyHint` and retained handles, RF-3206) and the
 * write-path setup tools, and wires the relaxed startup gate (RF-3202) + dynamic
 * read-only enablement after provisioning (RF-3202b).
 *
 * Extracted from index.ts so it can be unit-tested without a stdio transport:
 * tests inspect `readOnlyHandles[].enabled` and invoke `setupTools[].handler`.
 */
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SealMetricsClient } from "./client.js";
import { ALL_TOOLS, CHANNEL_WRITE_TOOLS, type ToolDef } from "./tools/index.js";
import { createSetupTools, type SetupContext, type SetupState, type SetupToolDef } from "./tools/setup.js";
import { INSTALL_SOURCE } from "./embedded.js";
import {
  TRACKING_GUIDE_URI,
  TRACKING_GUIDE_NAME,
  TRACKING_GUIDE_DESCRIPTION,
  TRACKING_GUIDE_CONTENT,
} from "./resources/tracking-guide.js";
import {
  MARKETING_GUIDE_URI,
  MARKETING_GUIDE_NAME,
  MARKETING_GUIDE_DESCRIPTION,
  MARKETING_GUIDE_CONTENT,
} from "./resources/marketing-guide.js";
import {
  TROUBLESHOOTING_GUIDE_URI,
  TROUBLESHOOTING_GUIDE_NAME,
  TROUBLESHOOTING_GUIDE_DESCRIPTION,
  TROUBLESHOOTING_GUIDE_CONTENT,
} from "./resources/troubleshooting-guide.js";

const MAX_RESPONSE_LENGTH = 100_000;

export interface BuildServerOptions {
  /** Read-only api_key. Omit to start in setup-only mode (RF-3202). */
  apiKey?: string;
  baseUrl: string;
  provisionKey: string;
  version: string;
  /** Project root if known (editors); undefined in Desktop chat. */
  cwd?: string;
  installSource?: string;
  pollDefaults?: { intervalMs?: number; timeoutMs?: number };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Transport gate for the remote (Streamable HTTP) entrypoint:
   * - `omitSetupTools` (VAL-RMT11): the write-path/setup tools are not
   *   registered — remote connections are read-only.
   * - `excludeReadOnlyTools` (RF-RMT25): tools whose API endpoints require
   *   scopes a modern api_key cannot carry are not listed remotely.
   * Both default to the local stdio behavior (everything registered).
   */
  omitSetupTools?: boolean;
  excludeReadOnlyTools?: ReadonlySet<string>;
  /**
   * Additional read-only tools registered with the same pipeline as ALL_TOOLS
   * (B6: the remote entrypoint appends the ChatGPT-compat `search`/`fetch`).
   */
  extraReadOnlyTools?: ToolDef[];
  /**
   * Public URL of the server icon (MCP spec 2025-11 `icons` metadata). Clients
   * that support it render the logo instead of name initials.
   */
  iconUrl?: string;
  /**
   * Site injected into every read-only tool call that doesn't pass one. The
   * remote transport sets it when the OAuth connection resolves to exactly one
   * site (PRD-043 DEC-09) so the model never needs list_sites to start; with
   * several sites it is left unset and every call must name a `site_id`.
   */
  defaultSiteId?: string;
  /**
   * MCP `instructions` handed to the client on `initialize`. Only the remote
   * transport sets it (PRD-043 RF-005) — the stdio behavior is unchanged.
   * Read once per session by the client, so the text must be static and cover
   * both the single- and multi-site cases.
   */
  instructions?: string;
}

export interface BuiltServer {
  server: McpServer;
  client: SealMetricsClient;
  readOnlyHandles: RegisteredTool[];
  setupTools: SetupToolDef[];
  setupContext: SetupContext;
  enableReadOnlyTools: () => void;
}

function jsonSchemaToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const type = prop.type as string | undefined;
  const enumValues = prop.enum as string[] | undefined;
  const description = prop.description as string | undefined;
  const anyOf = prop.anyOf as Record<string, unknown>[] | undefined;

  let schema: z.ZodTypeAny;
  if (anyOf && anyOf.length > 0) {
    // Multi-value filters declare `anyOf: [string, array of string]` so a
    // model can pass one value without wrapping it in a list (PRD-062
    // RF-034). Without this branch the union fell through to `z.string()`
    // and every array argument was rejected.
    const options = anyOf.map((entry) => jsonSchemaToZod(entry));
    schema =
      options.length === 1
        ? options[0]
        : z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  } else if (enumValues && enumValues.length > 0) {
    schema = z.enum(enumValues as [string, ...string[]]);
  } else if (type === "number" || type === "integer") {
    schema = z.number();
  } else if (type === "boolean") {
    schema = z.boolean();
  } else if (type === "array") {
    // Structured payloads (e.g. import_channel_rules' rules) — validated
    // in depth by the API, not here.
    schema = z.array(z.any());
  } else if (type === "object") {
    schema = z.record(z.string(), z.any());
  } else {
    schema = z.string();
  }
  if (description) schema = schema.describe(description);
  return schema;
}

function buildShape(properties: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    shape[key] = jsonSchemaToZod(prop as Record<string, unknown>).optional();
  }
  return shape;
}

/**
 * Input schema for a tool, strict about unknown arguments (PRD-062 DEC-04).
 *
 * A plain `z.object(shape)` DROPS keys it does not know, which is how a model
 * could pass `country=Spain` to a tool without that parameter, get unfiltered
 * numbers back and report them as filtered — the failure this PRD exists to
 * fix. Two halves make it loud:
 *
 * - `.meta({ additionalProperties: false })` publishes the restriction in the
 *   listed JSON Schema, so a client that validates rejects the call up front.
 * - `.passthrough()` lets an unknown key survive the parse so the handler can
 *   answer with a tool error that names the accepted arguments. `.strict()`
 *   alone would instead raise a transport-level `McpError` whose text the
 *   model cannot act on.
 */
function buildInputSchema(properties: Record<string, unknown>): z.ZodTypeAny {
  return z
    .object(buildShape(properties))
    .passthrough()
    .meta({ additionalProperties: false }) as unknown as z.ZodTypeAny;
}

/**
 * The error text for a call carrying arguments the tool does not declare, or
 * `null` when every argument is known.
 */
export function unknownArgumentsError(
  toolName: string,
  properties: Record<string, unknown>,
  args: Record<string, unknown>,
): string | null {
  const accepted = Object.keys(properties);
  const unknown = Object.keys(args).filter((key) => !accepted.includes(key));
  if (unknown.length === 0) return null;
  const quoted = unknown.map((key) => `"${key}"`).join(", ");
  const label = unknown.length === 1 ? "argument" : "arguments";
  return (
    `Unknown ${label} ${quoted} for ${toolName}. ` +
    `Accepted: ${accepted.join(", ") || "(none)"}.`
  );
}

function safeStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length > MAX_RESPONSE_LENGTH) {
      return json.slice(0, MAX_RESPONSE_LENGTH) + "\n... (truncated)";
    }
    return json;
  } catch {
    return '{"error": "Response could not be serialized"}';
  }
}

function toToolResult(result: unknown) {
  return { content: [{ type: "text" as const, text: safeStringify(result) }] };
}

function toErrorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error occurred";
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function buildServer(opts: BuildServerOptions): BuiltServer {
  const client = new SealMetricsClient(opts.apiKey, opts.baseUrl);
  const server = new McpServer(
    {
      name: "sealmetrics",
      title: "SealMetrics",
      version: opts.version,
      websiteUrl: "https://sealmetrics.com",
      ...(opts.iconUrl
        ? { icons: [{ src: opts.iconUrl, mimeType: "image/png", sizes: ["512x512"] }] }
        : {}),
    },
    opts.instructions ? { instructions: opts.instructions } : undefined,
  );

  // Read-only data tools (~47): registerTool → readOnlyHint + retained handle.
  // Without an api_key they are registered but DISABLED (hidden from tools/list);
  // provision_site enables them in-session (RF-3202b).
  //
  // All three hints are declared, not just readOnlyHint, because the protocol's
  // defaults are the opposite of the truth here: an undeclared `openWorldHint`
  // means open internet and an undeclared `destructiveHint` means irreversible.
  // These tools read one customer's own analytics and change nothing, so
  // leaving the defaults advertised them to every client — and to the OpenAI
  // plugin review, which reads the three values and compares them with the
  // listing — as open-world and destructive.
  const registeredTools = [
    ...(opts.excludeReadOnlyTools
      ? ALL_TOOLS.filter((tool) => !opts.excludeReadOnlyTools!.has(tool.name))
      : ALL_TOOLS),
    ...(opts.extraReadOnlyTools ?? []),
  ];
  const readOnlyHandles = registeredTools.map((tool) => {
    const handle = server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: buildInputSchema(tool.inputSchema.properties),
        annotations: {
          title: tool.name,
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
      },
      // `args` is typed `unknown` because the schema is a Zod object rather
      // than a raw shape (see buildInputSchema); it is always the parsed
      // object for this tool.
      async (rawArgs: unknown) => {
        const args = (rawArgs ?? {}) as Record<string, unknown>;
        const unknownArgs = unknownArgumentsError(
          tool.name,
          tool.inputSchema.properties,
          args,
        );
        if (unknownArgs) return toErrorResult(new Error(unknownArgs));
        try {
          const finalArgs = opts.defaultSiteId
            ? { site_id: opts.defaultSiteId, ...args }
            : args;
          return toToolResult(await tool.handler(client, finalArgs));
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
    if (!client.hasApiKey()) handle.disable();
    return handle;
  });

  // Channel-rule write tools (PRD-035 CHG-014): draft-only writes. Registered
  // WITHOUT readOnlyHint, only for the local stdio transport (`omitSetupTools`
  // doubles as the remote read-only gate, VAL-RMT11). Like the data tools,
  // they need an api_key: hidden without one, enabled after provisioning.
  const channelWriteHandles = (opts.omitSetupTools ? [] : CHANNEL_WRITE_TOOLS).map((tool) => {
    const handle = server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: buildInputSchema(tool.inputSchema.properties),
        annotations: { title: tool.name, readOnlyHint: false, destructiveHint: tool.destructiveHint },
      },
      // `args` is typed `unknown` because the schema is a Zod object rather
      // than a raw shape (see buildInputSchema); it is always the parsed
      // object for this tool.
      async (rawArgs: unknown) => {
        const args = (rawArgs ?? {}) as Record<string, unknown>;
        const unknownArgs = unknownArgumentsError(
          tool.name,
          tool.inputSchema.properties,
          args,
        );
        if (unknownArgs) return toErrorResult(new Error(unknownArgs));
        try {
          const finalArgs = opts.defaultSiteId
            ? { site_id: opts.defaultSiteId, ...args }
            : args;
          return toToolResult(await tool.handler(client, finalArgs));
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
    if (!client.hasApiKey()) handle.disable();
    return handle;
  });

  const enableReadOnlyTools = (): void => {
    for (const handle of [...readOnlyHandles, ...channelWriteHandles]) {
      if (!handle.enabled) handle.enable(); // fires notifications/tools/list_changed
    }
  };

  // Write-path setup tools.
  const setupState: SetupState = { provisioned: false, pixelVerified: false };
  const setupContext: SetupContext = {
    client,
    baseUrl: opts.baseUrl,
    provisionKey: opts.provisionKey,
    installSource: opts.installSource ?? INSTALL_SOURCE,
    cwd: opts.cwd,
    state: setupState,
    onProvisioned: (apiKey: string, _accountId: string) => {
      client.setApiKey(apiKey); // in memory only (VAL-3201)
      enableReadOnlyTools(); // RF-3202b (accountId already set on ctx.state by the handler)
    },
    pollDefaults: opts.pollDefaults,
    now: opts.now,
    sleep: opts.sleep,
  };

  const setupTools = opts.omitSetupTools ? [] : createSetupTools(setupContext);
  for (const tool of setupTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: buildInputSchema(tool.inputSchema.properties),
        annotations: tool.annotations,
      },
      // `args` is typed `unknown` because the schema is a Zod object rather
      // than a raw shape (see buildInputSchema); it is always the parsed
      // object for this tool.
      async (rawArgs: unknown) => {
        const args = (rawArgs ?? {}) as Record<string, unknown>;
        const unknownArgs = unknownArgumentsError(
          tool.name,
          tool.inputSchema.properties,
          args,
        );
        if (unknownArgs) return toErrorResult(new Error(unknownArgs));
        try {
          return toToolResult(await tool.handler(args));
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
  }

  // Resources
  server.resource(
    TRACKING_GUIDE_NAME,
    TRACKING_GUIDE_URI,
    { description: TRACKING_GUIDE_DESCRIPTION, mimeType: "text/markdown" },
    async () => ({
      contents: [{ uri: TRACKING_GUIDE_URI, mimeType: "text/markdown", text: TRACKING_GUIDE_CONTENT }],
    }),
  );

  server.resource(
    MARKETING_GUIDE_NAME,
    MARKETING_GUIDE_URI,
    { description: MARKETING_GUIDE_DESCRIPTION, mimeType: "text/markdown" },
    async () => ({
      contents: [{ uri: MARKETING_GUIDE_URI, mimeType: "text/markdown", text: MARKETING_GUIDE_CONTENT }],
    }),
  );

  server.resource(
    TROUBLESHOOTING_GUIDE_NAME,
    TROUBLESHOOTING_GUIDE_URI,
    { description: TROUBLESHOOTING_GUIDE_DESCRIPTION, mimeType: "text/markdown" },
    async () => ({
      contents: [
        { uri: TROUBLESHOOTING_GUIDE_URI, mimeType: "text/markdown", text: TROUBLESHOOTING_GUIDE_CONTENT },
      ],
    }),
  );

  return { server, client, readOnlyHandles, setupTools, setupContext, enableReadOnlyTools };
}
