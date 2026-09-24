import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness } from "./helpers.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "public", name), "utf8"));

/** Every CLI command the leak test exercises; later phases append their commands here. */
export const LEAK_COMMANDS: string[][] = [
  ["profile", "list"],
  ["profile", "list", "--verify"],
  ["profile", "show"],
  ["whoami"],
  ["doctor"],
  ["models", "list", "--q", "luna"],
  ["models", "show", "openai/gpt-6-luna-pro"],
  ["models", "endpoints", "openai/gpt-6-luna-pro"],
  ["providers", "list"],
  ["providers", "show", "openai"],
];

/** Extra fake routes needed by LEAK_COMMANDS beyond the profile basics. */
export function registerLeakFixtures(h: Harness): void {
  h.fetcher
    .get("/models", fixture("models.json"))
    .get("/providers", fixture("providers.json"))
    .get("/models/openai/gpt-6-luna-pro/endpoints", fixture("endpoints-openai__gpt-6-luna-pro.json"));
}
