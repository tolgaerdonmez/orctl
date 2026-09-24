import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { WS_RESEARCH } from "../fixtures/auth.ts";
import { serveKeys } from "../fixtures/keys.ts";
import { WorkspaceServer } from "../fixtures/workspace-server.ts";
import { type Harness, harness, scriptedPrompter } from "../helpers.ts";

let h: Harness;
let ws: WorkspaceServer;
beforeEach(() => {
  h = harness({ env: { ORCTL_MANAGEMENT_KEY: FAKE_MGMT_KEY } });
  serveKeys(h.fetcher);
  ws = new WorkspaceServer(h.fetcher);
});
afterEach(() => h.cleanup());

describe("workspaces (plan §7.2)", () => {
  test("list and show (budgets, members, key count)", async () => {
    const list = await h.cli(["workspaces", "list"]);
    expect(list.stdout.split("\n")[0]).toMatch(/^SLUG\s+NAME\s+DESCRIPTION\s+CREATED/);
    expect(list.stdout).toContain("research  Research    ML experiments");
    const show = await h.cli(["workspaces", "show", "Research"]);
    expect(show.code).toBe(0);
    expect(show.stdout).toContain("Keys         2");
    expect(show.stdout).toContain("Members      2");
    expect(show.stdout).toContain("monthly   $100.00");
    expect(show.stdout).toContain("user_alice · admin");
  });

  test("create derives the slug; update; members table", async () => {
    const r = await h.cli(["workspaces", "create", "Data Science", "--description", "DS team"]);
    expect(r.code).toBe(0);
    expect(h.fetcher.callsTo("POST", "/workspaces")[0]?.json()).toEqual({
      name: "Data Science",
      slug: "data-science",
      description: "DS team",
    });
    expect(r.stderr).toContain("workspaces.create");
    const u = await h.cli(["workspaces", "update", "data-science", "--name", "DS"]);
    expect(u.stdout).toContain('Updated workspace "DS" (data-science)');
    expect((await h.cli(["workspaces", "update", "data-science"])).code).toBe(2);
    const m = await h.cli(["workspaces", "members", "research"]);
    expect(m.stdout).toContain("read-only");
    expect(m.stdout).toMatch(/user_bob\s+member/);
  });

  test("rm: typed slug on a terminal, --yes otherwise; never the default workspace", async () => {
    expect((await h.cli(["workspaces", "rm", "prod"])).code).toBe(2);
    const prompter = scriptedPrompter(["prod"]);
    const r = await h.cli(["workspaces", "rm", "prod"], { stdinIsTTY: true, stdoutIsTTY: true, prompter });
    expect(r.code).toBe(0);
    expect(prompter.asked[0]).toContain('Delete workspace "Production" (prod)');
    expect(ws.workspaces.map((w) => w.slug)).toEqual(["default", "research"]);
    const d = await h.cli(["workspaces", "rm", "default", "--yes"]);
    expect(d.code).toBe(2);
    expect(h.fetcher.callsTo("DELETE", /^\/workspaces\//).length).toBe(1);
  });

  test("budgets: list, set (PUT with limit_usd), remove", async () => {
    const list = await h.cli(["workspaces", "budget", "list", "research"]);
    expect(list.stdout).toMatch(/monthly\s+\$100.00/);
    const set = await h.cli(["workspaces", "budget", "set", "research", "daily", "12.5", "--include-byok"]);
    expect(set.code).toBe(0);
    const put = h.fetcher.callsTo("PUT", /budgets\/daily$/)[0];
    expect(put?.path).toBe(`/workspaces/${WS_RESEARCH}/budgets/daily`);
    expect(put?.json()).toEqual({ limit_usd: 12.5, include_byok_in_budgets: true });
    expect(set.stdout).toContain("daily budget of research set to $12.50");
    expect((await h.cli(["workspaces", "budget", "set", "research", "hourly", "1"])).code).toBe(2);
    expect((await h.cli(["workspaces", "budget", "set", "research", "daily", "lots"])).code).toBe(2);
    const rm = await h.cli(["workspaces", "budget", "rm", "research", "monthly", "--yes"]);
    expect(rm.stdout).toContain("Removed the monthly budget of research");
    const json = JSON.parse((await h.cli(["workspaces", "budget", "list", "research", "--json"])).stdout);
    expect(json.data.budgets.map((b: { resetInterval: string }) => b.resetInterval)).toEqual(["daily"]);
  });
});
