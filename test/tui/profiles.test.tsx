import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OPERATIONS } from "../../src/core/ops/registry.ts";
import { TUI_ACTIONS } from "../../src/tui/actions.ts";
import { FAKE_MGMT_KEY, FAKE_OTHER_MGMT_KEY } from "../fakes/keys.ts";
import { credits, currentKey, workspaces } from "../fixtures/auth.ts";
import { type Harness, harness } from "../helpers.ts";
import { renderTui, type TuiDriver } from "./helpers.tsx";

let h: Harness;
let ui: TuiDriver | undefined;

beforeEach(async () => {
  h = harness();
  h.fetcher.get("/credits", credits()).get("/workspaces", workspaces()).get("/key", currentKey());
  h.fetcher.get("/models/count", { data: { count: 458 } });
});
afterEach(async () => {
  await ui?.destroy();
  ui = undefined;
  h.cleanup();
});

async function seedProfiles() {
  await h.cli(["profile", "add", "personal", "--mgmt-key-stdin", "--label", "Kişisel", "--color", "green"], {
    stdin: FAKE_MGMT_KEY,
  });
  h.op.values["op://Work/ACME/management key"] = FAKE_OTHER_MGMT_KEY;
  await h.cli([
    "profile",
    "add",
    "acme",
    "--mgmt-key-ref",
    "op://Work/ACME/management key",
    "--color",
    "red",
  ]);
}

describe("TUI parity (plan §5.2 condition 2)", () => {
  test("every TUI action names a registered operation, and every operation is reachable", () => {
    const ops = new Set<string>(OPERATIONS.map((o) => o.id));
    expect(TUI_ACTIONS.filter((a) => !ops.has(a.op))).toEqual([]);
    const reachable = new Set(TUI_ACTIONS.map((a) => a.op));
    expect([...ops].filter((o) => !reachable.has(o))).toEqual([]);
  });
});

describe("TUI shell and Profiles screen (plan §7.3, F2)", () => {
  test("no profile: welcome card and public-only header", async () => {
    ui = await renderTui(h);
    const f = ui.frame();
    expect(f).toContain("no profile · public data only");
    expect(f).toContain("1 Dashboard");
    expect(f).toContain("7 Profiles");
    expect(f).toContain("Press a to add a profile");
    expect(f).toContain("CLI: orctl profile add personal");
  });

  test("header badge, whoami card and CLI hint for the active profile", async () => {
    await seedProfiles();
    ui = await renderTui(h);
    const f = await ui.waitFor((x) => x.includes("role verified"), "whoami");
    expect(f).toContain("● personal · Kişisel · ws default · [M]");
    expect(f).toContain("credits $50.00");
    expect(f).toContain("CLI: orctl whoami");
  });

  test("deep link to profiles; enter switches profile and persists it", async () => {
    await seedProfiles();
    ui = await renderTui(h, { screen: "profiles" });
    await ui.waitFor((f) => f.includes("acme") && f.includes("personal"), "profile list");
    await ui.press("j");
    await ui.enter();
    const f = await ui.waitFor((x) => x.includes("● acme"), "header shows acme");
    expect(f).toContain("CLI: orctl profile list");
    const state = JSON.parse(readFileSync(`${h.env.XDG_STATE_HOME}/orctl/state.json`, "utf8"));
    expect(state.current_profile).toBe("acme");
  });

  test("add wizard: masked key, verification, workspace, color, default → saved as keychain ref", async () => {
    ui = await renderTui(h, { screen: "profiles" });
    await ui.press("a");
    await ui.waitFor((f) => f.includes("Profile name"), "name step");
    await ui.type("work");
    await ui.enter();
    await ui.waitFor((f) => f.includes("Management key source"), "source step");
    await ui.enter(); // Paste (stored in Keychain)
    await ui.waitFor((f) => f.includes("Management key"), "secret step");
    await ui.paste(FAKE_MGMT_KEY);
    const masked = ui.frame();
    expect(masked).not.toContain(FAKE_MGMT_KEY.slice(0, 16));
    expect(masked).toContain("••••");
    await ui.enter();
    await ui.waitFor((f) => f.includes("Verified: management role"), "verification");
    expect(ui.frame()).toContain("CLI: orctl profile add work --mgmt-key-stdin");
    await ui.enter(); // no user key
    await ui.waitFor((f) => f.includes("Default workspace"), "workspace step");
    await ui.press("j"); // research
    await ui.enter();
    await ui.waitFor((f) => f.includes("Color"), "color step");
    await ui.press("j"); // green
    await ui.enter();
    await ui.waitFor((f) => f.includes("Make default?"), "default step");
    await ui.enter();
    await ui.waitFor((f) => f.includes("Saved profile work"), "saved toast");
    const cfg = readFileSync(h.env.ORCTL_CONFIG, "utf8");
    expect(cfg).toContain('management_key = "keychain:orctl/work/management"');
    expect(cfg).toContain('workspace = "research"');
    expect(cfg).toContain('color = "green"');
    expect(h.keychain.items.get("orctl/work/management")?.value).toBe(FAKE_MGMT_KEY);
    expect(ui.frame()).not.toContain(FAKE_MGMT_KEY.slice(0, 16));
  });

  test("D asks for the typed name before removing", async () => {
    await seedProfiles();
    ui = await renderTui(h, { screen: "profiles" });
    await ui.waitFor((f) => f.includes("acme"), "list");
    await ui.press("j");
    await ui.press("D", { shift: true });
    await ui.waitFor((f) => f.includes('Type "acme"'), "confirm modal");
    await ui.type("acm");
    await ui.enter();
    await ui.waitFor((f) => f.includes("did not match"), "mismatch");
    expect(readFileSync(h.env.ORCTL_CONFIG, "utf8")).toContain("[profiles.acme]");
    await ui.escape();
    await ui.press("D", { shift: true });
    await ui.waitFor((f) => f.includes('Type "acme"'), "confirm modal again");
    await ui.type("acme");
    await ui.enter();
    await ui.waitFor((f) => f.includes("Removed acme"), "removed");
    expect(readFileSync(h.env.ORCTL_CONFIG, "utf8")).not.toContain("[profiles.acme]");
  });

  test("ctrl+p palette lists operations with their CLI form; ctrl+o switches profile", async () => {
    await seedProfiles();
    ui = await renderTui(h);
    await ui.press("p", { ctrl: true });
    let f = await ui.waitFor((x) => x.includes("Command palette"), "palette");
    expect(f).toContain("orctl profile add");
    await ui.type("rename");
    f = await ui.waitFor((x) => x.includes("Rename a profile") && !x.includes("Add a profile"), "filter");
    await ui.escape();
    await ui.press("o", { ctrl: true });
    await ui.waitFor((x) => x.includes("Switch profile"), "switcher");
    await ui.press("j");
    await ui.enter();
    await ui.waitFor((x) => x.includes("● acme"), "switched");
  });

  test("help lists keys and runs diagnostics; q quits", async () => {
    await seedProfiles();
    ui = await renderTui(h);
    await ui.press("?");
    await ui.waitFor((f) => f.includes("switch profile") && f.includes("command palette"), "help");
    await ui.press("d");
    await ui.waitFor((f) => f.includes("openrouter.ai reachable"), "doctor");
    await ui.press("q");
    expect(ui.exitCode()).toBe(0);
  });
});
