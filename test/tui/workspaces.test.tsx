import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { currentKey, WS_RESEARCH } from "../fixtures/auth.ts";
import { serveKeys } from "../fixtures/keys.ts";
import { WorkspaceServer } from "../fixtures/workspace-server.ts";
import { type Harness, harness } from "../helpers.ts";
import { renderTui, type TuiDriver } from "./helpers.tsx";

let h: Harness;
let ws: WorkspaceServer;
let ui: TuiDriver | undefined;
beforeEach(async () => {
  h = harness();
  serveKeys(h.fetcher);
  ws = new WorkspaceServer(h.fetcher);
  h.fetcher.get("/key", currentKey());
  await h.cli(["profile", "add", "acme", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
});
afterEach(async () => {
  await ui?.destroy();
  ui = undefined;
  h.cleanup();
});

describe("TUI Workspaces (plan §7.3, F8)", () => {
  test("detail tabs; add a budget; remove one; members are read-only", async () => {
    ui = await renderTui(h, { screen: "workspaces", width: 140, height: 32 });
    await ui.waitFor((f) => f.includes("research") && f.includes("ML experiments"), "list");
    await ui.press("j");
    await ui.enter();
    let f = await ui.waitFor((x) => x.includes("Workspace Research") && x.includes("monthly"), "detail");
    expect(f).toContain("2 keys · 2 members");
    expect(f).toContain("CLI: orctl workspaces budget list research");
    await ui.press("n");
    await ui.waitFor((x) => x.includes("Budget for research"), "budget form");
    await ui.press("ARROW_UP");
    await ui.press("ARROW_LEFT"); // weekly
    await ui.press("ARROW_LEFT"); // daily
    await ui.press("ARROW_DOWN");
    await ui.type("5");
    await ui.press("ARROW_DOWN");
    await ui.press("ARROW_DOWN");
    await ui.enter();
    f = await ui.waitFor((x) => x.includes("daily budget set to $5"), "saved");
    expect(ws.budgets.get(WS_RESEARCH)?.map((b) => b.reset_interval)).toEqual(["monthly", "daily"]);
    await ui.press("D", { shift: true });
    await ui.waitFor((x) => x.includes("Remove the monthly budget"), "confirm");
    await ui.press("y");
    await ui.waitFor((x) => x.includes("Removed the monthly budget"), "removed");
    await ui.press("TAB");
    f = await ui.waitFor((x) => x.includes("user_alice"), "members");
    expect(f).toContain("read-only");
    await ui.press("TAB");
    await ui.waitFor((x) => x.includes("notebook"), "keys tab");
  });

  test("create a workspace and delete it with the typed slug", async () => {
    ui = await renderTui(h, { screen: "workspaces", width: 140, height: 32 });
    await ui.waitFor((f) => f.includes("research"), "list");
    await ui.press("n");
    await ui.waitFor((x) => x.includes("New workspace"), "form");
    await ui.type("Data Team");
    let f = await ui.waitFor((x) => x.includes("CLI: orctl workspaces create 'Data Team'"), "hint");
    for (let i = 0; i < 3; i++) await ui.press("ARROW_DOWN");
    await ui.enter();
    f = await ui.waitFor((x) => x.includes("data-team"), "created");
    expect(ws.workspaces.map((w) => w.slug)).toContain("data-team");
    await ui.press("G");
    await ui.enter();
    await ui.waitFor((x) => x.includes("Workspace Data Team"), "detail");
    await ui.press("TAB");
    await ui.press("D", { shift: true });
    await ui.waitFor((x) => x.includes('Type "data-team"'), "typed");
    await ui.type("data-team");
    await ui.enter();
    f = await ui.waitFor((x) => x.includes("Deleted workspace data-team"), "deleted");
    expect(ws.workspaces.map((w) => w.slug)).not.toContain("data-team");
  });
});
