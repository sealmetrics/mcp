/**
 * Fase 3 Bloque 3 — `.mcpb` manifest validation (TEST-3301, automatable part).
 * The Claude Desktop smoke test (install, provision without key, query with key)
 * is a documented MANUAL step — see docs/mcp-server.md.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("manifest.json (.mcpb)", () => {
  it("is parseable and declares a node server with an entry point (RF-3301/3305)", () => {
    expect(manifest.name).toBe("sealmetrics");
    expect(manifest.server.type).toBe("node");
    expect(manifest.server.entry_point).toBe("server/index.js");
    // RF-3305: vendored/pinned server, NOT npx.
    expect(manifest.server.mcp_config.command).toBe("node");
    expect(JSON.stringify(manifest.server.mcp_config)).not.toContain("npx");
  });

  it("config schema exposes SEALMETRICS_API_KEY as OPTIONAL + sensitive (RF-3301/3302)", () => {
    const api = manifest.user_config.api_key;
    expect(api.required).toBe(false);
    expect(api.sensitive).toBe(true);
    expect(manifest.server.mcp_config.env.SEALMETRICS_API_KEY).toContain("user_config.api_key");
  });

  it("base_url defaults to PROD (RF-3301)", () => {
    expect(manifest.user_config.base_url.default).toBe("https://my.sealmetrics.com/api/v1");
  });

  it("declares the setup tools incl. the write-path provision_site (RF-3302)", () => {
    const names = manifest.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("provision_site");
    expect(names).toContain("verify_setup");
    expect(names).toContain("get_instrumentation_guide");
    expect(names).toContain("plan_install");
    expect(names).toContain("simulate_install");
  });

  it("embeds NO secret (VAL-3301): no api_key value, no provision key literal", () => {
    const blob = JSON.stringify(manifest);
    expect(blob).not.toMatch(/sm_[A-Za-z0-9]{8,}/); // no api key
    expect(blob).not.toMatch(/pk_(npx|mcp)_[A-Za-z0-9]{6,}/); // no embedded provision key
  });

  it("manifest version tracks the package version", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it("references an icon that exists", () => {
    expect(() => readFileSync(join(root, manifest.icon))).not.toThrow();
  });
});

/**
 * Connectors Directory requirements for a local extension (PRD
 * mcpb-directory-listing, RF-DIR06..DIR10). Missing or incomplete privacy
 * policies are an immediate rejection; the Desktop Extensions form also asks
 * for a public GitHub repo, an MIT licence and an `author` pointing at GitHub.
 */
describe("manifest.json — Connectors Directory requirements", () => {
  const PUBLIC_REPO = "https://github.com/sealmetrics/mcp";
  const PRIVACY_URL = "https://sealmetrics.com/privacy/";
  const readme = readFileSync(join(root, "README.md"), "utf8");

  it("uses manifest_version 0.3, the first one with privacy_policies", () => {
    expect(manifest.manifest_version).toBe("0.3");
  });

  it("declares an HTTPS privacy policy in the manifest", () => {
    expect(manifest.privacy_policies).toEqual([PRIVACY_URL]);
  });

  it("has a Privacy Policy section in the README that links the same policy", () => {
    const section = readme.split(/^## /m).find((s) => s.startsWith("Privacy Policy"));
    expect(section).toBeDefined();
    expect(section).toContain(PRIVACY_URL);
    // The five topics the directory policy asks the privacy policy to cover.
    for (const topic of [/collect/i, /stor/i, /third[- ]part/i, /retention|retain/i, /contact/i]) {
      expect(section).toMatch(topic);
    }
  });

  it("points author, documentation and support at public destinations", () => {
    expect(manifest.author.url).toBe("https://github.com/sealmetrics");
    expect(manifest.documentation).toBe("https://docs.sealmetrics.com/integrations/mcp-server");
    expect(manifest.support).toBe(`${PUBLIC_REPO}/issues`);
    const githubUrls = JSON.stringify({ manifest, pkg }).match(/github\.com\/[\w.-]+/g) ?? [];
    expect(githubUrls.length).toBeGreaterThan(0);
    for (const url of githubUrls) expect(url).toBe("github.com/sealmetrics");
  });

  it("package.json points at the public repo", () => {
    expect(pkg.repository.url).toBe(`git+${PUBLIC_REPO}.git`);
    expect(pkg.bugs.url).toBe(`${PUBLIC_REPO}/issues`);
  });

  it("ships an MIT LICENSE file", () => {
    expect(existsSync(join(root, "LICENSE"))).toBe(true);
    expect(readFileSync(join(root, "LICENSE"), "utf8")).toMatch(/^MIT License/);
    expect(manifest.license).toBe("MIT");
  });

  it("uses the Sealmetrics brand spelling in user-facing manifest text", () => {
    const text = [manifest.display_name, manifest.description, manifest.long_description].join(" ");
    expect(text).not.toContain("SealMetrics");
  });

  it("passes the official mcpb schema validation", () => {
    const bin = join(root, "node_modules", ".bin", "mcpb");
    expect(() => execFileSync(bin, ["validate", join(root, "manifest.json")], { stdio: "pipe" })).not.toThrow();
  });
});
