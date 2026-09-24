import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { KeyServer } from "../fixtures/key-server.ts";
import { type Harness, harness } from "../helpers.ts";
import { renderTui, type TuiDriver } from "./helpers.tsx";

let h: Harness;
let server: KeyServer;
let ui: TuiDriver | undefined;
beforeEach(async () => {
  h = harness();
  server = new KeyServer(h.fetcher, () => h.clock.now());
  server.add("ci-bot", { limit: 50, limit_remaining: 20, limit_reset: "monthly" });
  await h.cli(["profile", "add", "acme", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
});
afterEach(async () => {
  await ui?.destroy();
  ui = undefined;
  h.cleanup();
});

describe("TUI RotateWizard (plan §7.3, F6)", () => {
  test("plan → show once → confirm → live steps → reveal; old key disabled", async () => {
    ui = await renderTui(h, { screen: "keys", width: 140, height: 34 });
    await ui.waitFor((f) => f.includes("ci-bot"), "list");
    await ui.press("r");
    let f = await ui.waitFor((x) => x.includes("1 Plan") && x.includes("limit $50.00 monthly"), "plan");
    expect(f).toContain('disabled and renamed to "ci-bot (rotated 2026-09-24)"');
    expect(f).toContain("CLI: orctl keys rotate ci-bot --store");
    await ui.enter();
    await ui.waitFor((x) => x.includes("2 Where should the new key go?"), "delivery");
    await ui.press("j");
    await ui.enter();
    f = await ui.waitFor((x) => x.includes("3 Confirm"), "confirm");
    expect(f).toContain("CLI: orctl keys rotate ci-bot --show");
    await ui.press("y");
    f = await ui.waitFor((x) => x.includes("Rotated key: shown once"), "reveal");
    const created = server.created[0];
    expect(f).toContain(created?.key as string);
    expect(f).toContain("✔ verify new key");
    expect(server.keys.find((k) => k.name.includes("rotated"))?.disabled).toBe(true);
    await ui.press("c");
    await ui.enter();
    f = await ui.waitFor((x) => x.includes("5 Done"), "done");
    expect(f).not.toContain(created?.key as string);
  });

  test("delete-old requires typing the name", async () => {
    ui = await renderTui(h, { screen: "keys", width: 140, height: 34 });
    await ui.waitFor((f) => f.includes("ci-bot"), "list");
    await ui.press("r");
    await ui.waitFor((x) => x.includes("1 Plan"), "plan");
    await ui.press("d");
    await ui.waitFor((x) => x.includes("DELETED"), "delete toggled");
    await ui.enter();
    await ui.press("j");
    await ui.press("j");
    await ui.enter(); // copy
    await ui.waitFor((x) => x.includes('Type "ci-bot"'), "typed confirm");
    await ui.type("ci-bot");
    await ui.enter();
    await ui.waitFor((x) => x.includes("5 Done"), "done");
    expect(server.keys.length).toBe(1);
    expect(server.keys[0]?.name).toBe("ci-bot");
    expect(h.clipboard.value).toBe(server.created[0]?.key as string);
  });
});
