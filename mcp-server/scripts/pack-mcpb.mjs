#!/usr/bin/env node
/**
 * Reproducible `.mcpb` build (Fase 3 Bloque 3, RF-3304). Produces
 * `dist/sealmetrics.mcpb`, a Claude Desktop Extension that vendors a pinned,
 * self-contained server (RF-3305 — no `npx`, no Node toolchain, no network at
 * startup; Claude Desktop supplies the Node runtime).
 *
 * Steps:
 *   1. `tsc` build  → dist/index.js (+ tool modules)
 *   2. esbuild FULL bundle (sdk + zod + setup-core inlined) → staging/server/index.js
 *      so the extension needs no node_modules.
 *   3. stage manifest.json + assets/
 *   4. `mcpb pack`  → dist/sealmetrics.mcpb
 *   5. `mcpb sign`  (RF-3308) if a signing cert is configured (best-effort)
 *
 * A bumped `version` in manifest.json (same `name`) → re-pack → re-host
 * (RF-3306: no auto-update; the user re-downloads + reinstalls).
 *
 * Requires the `@anthropic-ai/mcpb` dev dependency (bin `mcpb`). VAL-3301: the
 * manifest embeds NO secret — the api_key is entered by the user at install, and
 * the provision key used by the setup tools is the publishable mcp-channel key.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const staging = join(root, "build", "mcpb");
const outFile = join(dist, "sealmetrics.mcpb");
const mcpbBin = join(root, "node_modules", ".bin", "mcpb");

function run(bin, args, opts = {}) {
  execFileSync(bin, args, { stdio: "inherit", cwd: root, ...opts });
}

// 1) Compile.
run("npm", ["run", "build"]);

// 2) Full self-contained bundle (inline EVERYTHING — sdk, zod, setup-core).
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "server"), { recursive: true });
await build({
  entryPoints: [join(dist, "index.js")],
  outfile: join(staging, "server", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // platform:node keeps Node built-ins external; everything else is inlined.
});

// 3) Stage manifest + assets + a minimal root package.json.
cpSync(join(root, "manifest.json"), join(staging, "manifest.json"));
if (existsSync(join(root, "assets"))) {
  cpSync(join(root, "assets"), join(staging, "assets"), { recursive: true });
}
// The bundled server is ESM and reads its version from a sibling package.json.
// A minimal `{ type:"module", version }` at the extension root makes Node load
// server/index.js as ESM AND satisfies the runtime version read (no crash).
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
writeFileSync(
  join(staging, "package.json"),
  JSON.stringify({ name: "sealmetrics-mcpb", version: manifest.version, type: "module", private: true }, null, 2),
);

// 4) Pack.
if (!existsSync(mcpbBin)) {
  console.error(
    "\n[pack-mcpb] staged the extension at build/mcpb but `mcpb` is not installed.\n" +
      "Install the dev dependency and re-run:\n" +
      "  npm i -D @anthropic-ai/mcpb && npm run pack-mcpb\n",
  );
  process.exit(existsSync(join(staging, "server", "index.js")) ? 0 : 1);
}
run(mcpbBin, ["pack", staging, outFile]);

// 5) Sign (RF-3308) — best-effort; needs a configured signing cert.
//    Set MCPB_SIGN=1 (+ the cert env vars `mcpb sign` expects) to enable.
if (process.env.MCPB_SIGN === "1") {
  try {
    run(mcpbBin, ["sign", outFile]);
    console.error("[pack-mcpb] signed " + outFile);
  } catch (e) {
    console.error("[pack-mcpb] signing failed (continuing unsigned): " + (e?.message ?? e));
  }
} else {
  console.error(
    "[pack-mcpb] packed UNSIGNED. To sign (RF-3308): set MCPB_SIGN=1 with a signing cert configured for `mcpb sign`.",
  );
}

console.error("[pack-mcpb] done → " + outFile);
