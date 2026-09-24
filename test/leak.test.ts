import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALL_FAKE_KEYS, FAKE_MGMT_KEY, FAKE_USER_KEY } from "./fakes/keys.ts";
import { credits, currentKey, workspaces } from "./fixtures/auth.ts";
import { type Harness, harness } from "./helpers.ts";
import { LEAK_COMMANDS, registerLeakFixtures } from "./leak-commands.ts";

/**
 * Leak test (plan §9, §10): every command runs with fake keys under OPENROUTER_DEBUG=1 and
 * --debug; no full key may appear on stdout, stderr, or anywhere under the cache/state dirs.
 */
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const leaked = (text: string) => ALL_FAKE_KEYS.filter((k) => text.includes(k));

let h: Harness;
let savedDebug: string | undefined;
beforeAll(async () => {
  savedDebug = process.env.OPENROUTER_DEBUG;
  process.env.OPENROUTER_DEBUG = "1";
  h = harness({
    env: { OPENROUTER_DEBUG: "1", OPENROUTER_API_KEY: FAKE_USER_KEY, MY_USER_KEY: FAKE_USER_KEY },
  });
  h.fetcher
    .get("/credits", credits())
    .get("/workspaces", workspaces())
    .get("/key", currentKey())
    .get("/models/count", { data: { count: 3 } });
  registerLeakFixtures(h);
  const add = await h.cli(["profile", "add", "personal", "--mgmt-key-stdin", "--debug"], {
    stdin: FAKE_MGMT_KEY,
  });
  expect(add.code).toBe(0);
  expect(leaked(add.stdout + add.stderr)).toEqual([]);
  await h.cli(["profile", "set", "personal", "--user-key-ref", "env:MY_USER_KEY"]);
});
afterAll(() => {
  if (savedDebug === undefined) delete process.env.OPENROUTER_DEBUG;
  else process.env.OPENROUTER_DEBUG = savedDebug;
  h.cleanup();
});

describe("no key material leaks (S1, S5, S6, S8, S9)", () => {
  for (const argv of LEAK_COMMANDS) {
    for (const mode of ["text", "json"] as const) {
      test(`${argv.join(" ")} [${mode}]`, async () => {
        const args = [...argv, "--debug", ...(mode === "json" ? ["--json"] : [])];
        const r = await h.cli(args, { stdin: "" });
        expect(leaked(r.stdout)).toEqual([]);
        expect(leaked(r.stderr)).toEqual([]);
      });
    }
  }

  test("cache and state dirs hold no key material", () => {
    const files = [
      ...walk(resolve(h.dir, "cache")),
      ...walk(resolve(h.dir, "state")),
      ...walk(resolve(h.dir, "config")),
    ];
    for (const f of files) expect({ f, leaked: leaked(readFileSync(f, "utf8")) }).toEqual({ f, leaked: [] });
  });

  test("fixtures contain no real-looking keys (S10)", () => {
    const root = resolve(import.meta.dir);
    for (const f of walk(join(root, "fixtures"))) {
      expect({ f, real: /sk-or-(v1|mgmt)-[0-9a-f]{40,}/.test(readFileSync(f, "utf8")) }).toEqual({
        f,
        real: false,
      });
    }
  });
});
