import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { serveActivity } from "../fixtures/activity.ts";
import { currentKey } from "../fixtures/auth.ts";
import { serveKeys } from "../fixtures/keys.ts";
import { type Harness, harness } from "../helpers.ts";
import { renderTui, type TuiDriver } from "./helpers.tsx";

let h: Harness;
let ui: TuiDriver | undefined;
beforeEach(async () => {
  h = harness();
  serveKeys(h.fetcher);
  serveActivity(h.fetcher);
  h.fetcher.get("/key", currentKey());
  await h.cli(["profile", "add", "acme", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
});
afterEach(async () => {
  await ui?.destroy();
  ui = undefined;
  h.cleanup();
});

describe("TUI Usage (plan §7.3, F7)", () => {
  test("breakdown tabs, date window and CLI hint", async () => {
    ui = await renderTui(h, { screen: "usage", width: 150, height: 32 });
    let f = await ui.waitFor(
      (x) => x.includes("anthropic/claude-sonnet-5") && x.includes("$25.00"),
      "by model",
    );
    expect(f).toContain("Total  $32.50");
    expect(f).toContain("CLI: orctl usage");
    await ui.press("[");
    f = await ui.waitFor((x) => x.includes("last 14 days"), "14 days");
    expect(f).toContain("CLI: orctl usage --days 14");
    await ui.press("TAB");
    f = await ui.waitFor((x) => x.includes("Anthropic") && x.includes("Azure"), "by provider");
    expect(f).toContain("CLI: orctl usage --by provider --days 14");
    for (let i = 0; i < 3; i++) await ui.press("TAB");
    f = await ui.waitFor((x) => x.includes("ALL TIME"), "by key");
    expect(f).toContain("per-key usage counters");
  });

  test("dashboard shows the top models of the last 7 days", async () => {
    ui = await renderTui(h, { width: 150, height: 40 });
    const f = await ui.waitFor((x) => x.includes("Top models, last 7 days") && x.includes("$18.00"), "card");
    expect(f).toContain("anthropic/claude-sonnet-5");
  });
});
