import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveActivity } from "./fixtures/activity.ts";
import { KeyServer } from "./fixtures/key-server.ts";
import { serveKeys } from "./fixtures/keys.ts";
import { WorkspaceServer } from "./fixtures/workspace-server.ts";
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
  ["keys", "list", "--include-disabled"],
  ["keys", "show", "laptop"],
  ["credits"],
  // --show prints the key by design and is excluded; every other delivery path must not.
  ["keys", "create", "leak-store", "--store"],
  ["keys", "create", "leak-copy", "--copy"],
  ["keys", "update", "laptop", "--limit", "5"],
  ["keys", "disable", "laptop"],
  ["keys", "rm", "laptop", "--yes"],
  ["usage"],
  ["usage", "--by", "key"],
  ["usage", "--by", "workspace", "--days", "7"],
  ["keys", "rotate", "ci-bot", "--workspace", "default", "--store", "--yes"],
  ["keys", "rotate", "ci-bot", "--workspace", "default", "--copy", "--yes", "--no-verify"],
  ["workspaces", "list"],
  ["workspaces", "show", "research"],
  ["workspaces", "create", "Leak Test"],
  ["workspaces", "budget", "set", "research", "daily", "5"],
  ["workspaces", "budget", "rm", "research", "daily", "--yes"],
  ["workspaces", "members", "research"],
];

/** Extra fake routes needed by LEAK_COMMANDS beyond the profile basics. */
export function registerLeakFixtures(h: Harness): void {
  // KeyServer answers create/update/delete; serveKeys (registered later, so it wins) answers reads.
  new KeyServer(h.fetcher, () => h.clock.now());
  serveKeys(h.fetcher);
  serveActivity(h.fetcher);
  new WorkspaceServer(h.fetcher);
  h.fetcher
    .get("/models", fixture("models.json"))
    .get("/providers", fixture("providers.json"))
    .get("/models/openai/gpt-6-luna-pro/endpoints", fixture("endpoints-openai__gpt-6-luna-pro.json"));
}
