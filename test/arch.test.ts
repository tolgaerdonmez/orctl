import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Layer rule (plan §4.2, §5.1): core depends on nothing above it; surface only on core; cli and
 * tui only on surface and core, never on each other. The TUI is reached from main.ts through a
 * lazy import, so a CLI command never loads OpenTUI.
 */
const SRC = resolve(import.meta.dir, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const IMPORT =
  /(?:import|export)\s[^"'`]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").filter(Boolean);
}

function layerOf(file: string): string {
  const rel = relative(SRC, file);
  const top = rel.split("/")[0] ?? "";
  return rel.includes("/") ? top : "root";
}

const ALLOWED_EXTERNAL: Record<string, RegExp[]> = {
  core: [/^node:/, /^@openrouter\/sdk/, /^zod$/, /^smol-toml$/],
  surface: [/^node:/],
  cli: [/^node:/, /^commander$/, /^@commander-js\//, /^@clack\/prompts$/],
  tui: [/^node:/, /^react$/, /^react\//, /^@opentui\//, /^@tanstack\/react-query$/],
  root: [/^node:/],
};

const ALLOWED_INTERNAL: Record<string, string[]> = {
  core: ["core"],
  surface: ["surface", "core"],
  cli: ["cli", "surface", "core"],
  tui: ["tui", "surface", "core"],
  root: ["cli", "core", "surface", "tui"],
};

describe("architecture: import direction", () => {
  const all = files(SRC);
  test("there are source files to check", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  for (const file of all) {
    const layer = layerOf(file);
    test(`${relative(SRC, file)} (${layer})`, () => {
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          if (!target.startsWith(SRC)) {
            // package.json (version) is the only allowed import from outside src/
            expect(relative(resolve(SRC, ".."), target)).toBe("package.json");
            continue;
          }
          const targetLayer = layerOf(
            target.endsWith(".ts") || target.endsWith(".tsx") ? target : `${target}.ts`,
          );
          expect({
            file: relative(SRC, file),
            imports: spec,
            allowed: ALLOWED_INTERNAL[layer]?.includes(targetLayer),
          }).toEqual({
            file: relative(SRC, file),
            imports: spec,
            allowed: true,
          });
        } else {
          const ok = (ALLOWED_EXTERNAL[layer] ?? []).some((re) => re.test(spec));
          expect({ file: relative(SRC, file), imports: spec, allowed: ok }).toEqual({
            file: relative(SRC, file),
            imports: spec,
            allowed: true,
          });
        }
      }
    });
  }

  test("main.ts reaches the TUI only through a dynamic import", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    expect(main).not.toMatch(/from\s+["']\.\/tui\//);
  });
});
