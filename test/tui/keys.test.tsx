import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { currentKey } from "../fixtures/auth.ts";
import { serveKeys } from "../fixtures/keys.ts";
import { type Harness, harness } from "../helpers.ts";
import { renderTui, type TuiDriver } from "./helpers.tsx";

let h: Harness;
let ui: TuiDriver | undefined;
beforeEach(async () => {
  h = harness();
  serveKeys(h.fetcher);
  h.fetcher.get("/key", currentKey());
  await h.cli(["profile", "add", "acme", "--mgmt-key-stdin", "--color", "red", "--label", "ACME org"], {
    stdin: FAKE_MGMT_KEY,
  });
});
afterEach(async () => {
  await ui?.destroy();
  ui = undefined;
  h.cleanup();
});

describe("TUI Keys and Dashboard (plan §7.3, F4)", () => {
  test("keys from every workspace, workspace cycling, disabled toggle, detail panel", async () => {
    ui = await renderTui(h, { screen: "keys", width: 150, height: 32 });
    let f = await ui.waitFor((x) => x.includes("api-server") && x.includes("notebook"), "keys");
    expect(f).toContain("workspace: all (tab)");
    expect(f).not.toContain("old ");
    expect(f).toContain("CLI: orctl keys list");
    await ui.press("TAB");
    f = await ui.waitFor((x) => x.includes("workspace: default"), "default ws");
    expect(f).toContain("CLI: orctl keys list --workspace default");
    expect(f).not.toContain("notebook");
    await ui.press("x");
    f = await ui.waitFor((x) => x.includes("disabled: shown"), "disabled shown");
    await ui.waitFor((x) => x.includes("old") && x.includes("disabled"), "old key");
    await ui.press("j");
    f = await ui.waitFor((x) => x.includes("Expires") && x.includes("2026-10-01"), "laptop detail");
    await ui.enter();
    f = await ui.waitFor((x) => x.includes("Key laptop"), "detail screen");
    expect(f).toContain("CLI: orctl keys show");
  });

  test("dashboard: credits, expiring soon, above 80% of limit", async () => {
    ui = await renderTui(h, { width: 150, height: 32 });
    const f = await ui.waitFor((x) => x.includes("75% used") && x.includes("laptop"), "dashboard cards");
    expect(f).toContain("● acme · ACME org");
    expect(f).toContain("Left     $12.40");
    expect(f).toMatch(/laptop …1c96 · in 7d/);
    expect(f).toContain("ci-bot · $5.00 left of $50.00");
  });
});
