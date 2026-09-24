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
  server.add("ci-bot", { limit: 50, limit_remaining: 50 });
  await h.cli(["profile", "add", "acme", "--mgmt-key-stdin", "--color", "red"], { stdin: FAKE_MGMT_KEY });
});
afterEach(async () => {
  await ui?.destroy();
  ui = undefined;
  h.cleanup();
});

describe("TUI key mutations (plan §7.3, F5)", () => {
  test("n → form → create → SecretReveal shows the key once → c copies → closed and gone", async () => {
    ui = await renderTui(h, { screen: "keys", width: 140, height: 32 });
    await ui.waitFor((f) => f.includes("ci-bot"), "list");
    await ui.press("n");
    await ui.waitFor((f) => f.includes("New key"), "form");
    await ui.type("tui-key");
    await ui.enter(); // → limit
    await ui.type("5");
    await ui.enter(); // → reset
    await ui.press("ARROW_RIGHT"); // daily
    await ui.press("ARROW_DOWN"); // expires
    await ui.type("7d");
    let f = await ui.waitFor(
      (x) => x.includes("CLI: orctl keys create tui-key --limit 5 --reset daily --expires 7d --store"),
      "hint",
    );
    for (let i = 0; i < 3; i++) await ui.press("ARROW_DOWN");
    await ui.enter(); // Create
    f = await ui.waitFor((x) => x.includes("shown once"), "reveal");
    const created = server.created[0];
    expect(created).toBeDefined();
    expect(f).toContain(created?.key as string);
    expect(h.fetcher.callsTo("POST", "/keys").length).toBe(1);
    await ui.press("c");
    await ui.waitFor((x) => x.includes("✔ copied"), "copied");
    expect(h.clipboard.value).toBe(created?.key as string);
    await ui.enter();
    f = await ui.waitFor((x) => !x.includes("shown once") && x.includes("tui-key"), "closed");
    expect(f).not.toContain(created?.key as string);
  });

  test("closing without copying or storing asks once more; s stores in the Keychain", async () => {
    ui = await renderTui(h, { screen: "keys", width: 140, height: 32 });
    await ui.waitFor((f) => f.includes("ci-bot"), "list");
    await ui.press("n");
    await ui.type("vault-key");
    for (let i = 0; i < 6; i++) await ui.press("ARROW_DOWN");
    await ui.enter();
    await ui.waitFor((x) => x.includes("shown once"), "reveal");
    await ui.enter();
    await ui.waitFor((x) => x.includes("cannot be shown again"), "warning");
    await ui.press("s");
    await ui.waitFor((x) => x.includes("✔ stored → keychain:orctl/acme/keys/vault-key-"), "stored");
    const created = server.created[0];
    expect(h.keychain.items.get(`orctl/acme/keys/vault-key-${created?.hash.slice(0, 8)}`)?.value).toBe(
      created?.key as string,
    );
    await ui.enter();
    await ui.waitFor((x) => !x.includes("shown once"), "closed");
  });

  test("space toggles with confirmation; D deletes after typing the name", async () => {
    ui = await renderTui(h, { screen: "keys", width: 140, height: 32 });
    await ui.waitFor((f) => f.includes("ci-bot"), "list");
    await ui.press(" ");
    await ui.waitFor(
      (f) => f.includes('Disable key "ci-bot"') && f.includes("in profile acme / workspace default"),
      "confirm",
    );
    await ui.press("y");
    await ui.waitFor((f) => f.includes("Disabled ci-bot"), "disabled");
    expect(server.keys[0]?.disabled).toBe(true);
    await ui.press("x");
    await ui.waitFor((f) => f.includes("disabled: shown"), "show disabled");
    await ui.press("D", { shift: true });
    await ui.waitFor((f) => f.includes('Type "ci-bot"'), "typed confirm");
    await ui.type("ci-bot");
    await ui.enter();
    await ui.waitFor((f) => f.includes("Deleted ci-bot"), "deleted");
    expect(server.keys.length).toBe(0);
  });
});
