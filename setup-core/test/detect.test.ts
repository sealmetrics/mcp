import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detect, detectFramework, detectPlatform } from "../src/detect/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "setup-core-detect-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function pkg(deps: Record<string, string>): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: deps }));
}

describe("detect (TEST-3101)", () => {
  it("detectFramework is the same function as detect (RF-3101 alias)", () => {
    expect(detectFramework).toBe(detect);
  });

  it("Next.js with app/ → next-app", () => {
    pkg({ next: "14" });
    mkdirSync(join(dir, "app"));
    expect(detect(dir).framework).toBe("next-app");
  });

  it("Next.js with pages/ only → next-pages", () => {
    pkg({ next: "13" });
    mkdirSync(join(dir, "pages"));
    expect(detect(dir).framework).toBe("next-pages");
  });

  it("astro/nuxt/sveltekit/vite detected from deps", () => {
    pkg({ astro: "4" });
    expect(detect(dir).framework).toBe("astro");
  });

  it("static index.html with no package.json → html", () => {
    writeFileSync(join(dir, "index.html"), "<html></html>");
    expect(detect(dir).framework).toBe("html");
  });

  it("empty dir → unknown + provisionOnly", () => {
    const d = detect(dir);
    expect(d.framework).toBe("unknown");
    expect(d.provisionOnly).toBe(true);
  });

  it("noInject forces provision-only", () => {
    pkg({ next: "14" });
    mkdirSync(join(dir, "app"));
    expect(detect(dir, { noInject: true }).provisionOnly).toBe(true);
  });

  it("WordPress markers → platform wordpress, strategy cms-plugin", () => {
    writeFileSync(join(dir, "wp-config.php"), "<?php");
    mkdirSync(join(dir, "wp-content"));
    const d = detect(dir);
    expect(d.platform).toBe("wordpress");
    expect(d.strategy).toBe("cms-plugin-wordpress");
    expect(detectPlatform(dir)).toBe("wordpress");
  });
});
