/**
 * Fills an orctl cache directory with the fixture model list (through the real op and SDK
 * parsing), so CI can smoke-test the compiled binary with `models list --offline`.
 * Usage: bun test/scripts/seed-cache.ts <cache-home>
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createContext } from "../../src/core/context.ts";
import { getOp } from "../../src/core/ops/registry.ts";
import { FakeFetcher } from "../fakes/fetcher.ts";

const target = resolve(process.argv[2] ?? ".tmp/ci-cache");
mkdirSync(target, { recursive: true });
const models = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "public", "models.json"), "utf8"),
);
const fetcher = new FakeFetcher().get("/models", models);
const ctx = await createContext(
  {
    env: { HOME: target, XDG_CACHE_HOME: target, ORCTL_CONFIG: join(target, "none.toml") },
    fetcher: fetcher.fetcher,
  },
  {},
);
const out = (await getOp("models.list").run(ctx, {})) as { count: number };
console.log(`seeded ${out.count} models into ${target}`);
