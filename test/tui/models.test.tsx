import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Harness, harness } from "../helpers.ts";
import { renderTui, type TuiDriver } from "./helpers.tsx";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "public", name), "utf8"));

let h: Harness;
let ui: TuiDriver | undefined;
beforeEach(() => {
  h = harness();
  h.fetcher
    .get("/models", fixture("models.json"))
    .get("/providers", fixture("providers.json"))
    .get("/models/openai/gpt-6-luna-pro/endpoints", fixture("endpoints-openai__gpt-6-luna-pro.json"));
});
afterEach(async () => {
  await ui?.destroy();
  ui = undefined;
  h.cleanup();
});

describe("TUI Models and Providers (plan §7.3, F3)", () => {
  test("models list without a profile, instant search, sort and CLI hint", async () => {
    ui = await renderTui(h, { screen: "models", width: 140 });
    let f = await ui.waitFor((x) => x.includes("16 of 16"), "model list");
    expect(f).toContain("IN $/M");
    expect(f).toContain("openrouter/auto");
    await ui.press("/");
    await ui.type("luna");
    f = await ui.waitFor((x) => x.includes("3 of 16"), "search result");
    expect(f).toContain("CLI: orctl models list --q luna");
    await ui.enter();
    await ui.press("s");
    f = await ui.waitFor((x) => x.includes("sort price"), "sorted");
    expect(f).toContain("--sort price");
    const lines = f.split("\n").filter((l) => l.includes("openai/gpt-6-luna"));
    expect(lines[0]).toContain("openai/gpt-6-luna:batch");
  });

  test("filters modal: free only", async () => {
    ui = await renderTui(h, { screen: "models", width: 140 });
    await ui.waitFor((x) => x.includes("16 of 16"), "model list");
    await ui.press("f");
    await ui.waitFor((x) => x.includes("Model filters"), "filters");
    for (let i = 0; i < 7; i++) await ui.press("ARROW_DOWN");
    await ui.press(" ");
    await ui.press("ARROW_DOWN");
    await ui.press("ARROW_DOWN");
    await ui.enter();
    const f = await ui.waitFor((x) => x.includes("2 of 16"), "free filter");
    expect(f).toContain("CLI: orctl models list --free");
  });

  test("model detail: overview, pricing tiers, endpoints", async () => {
    ui = await renderTui(h, { screen: "models", width: 140, height: 36 });
    await ui.waitFor((x) => x.includes("16 of 16"), "list");
    await ui.press("/");
    await ui.type("luna-pro");
    await ui.enter();
    await ui.enter();
    let f = await ui.waitFor((x) => x.includes("Overview") && x.includes("Context"), "overview");
    expect(f).toContain("1.05M tokens");
    expect(f).toContain("CLI: orctl models show openai/gpt-6-luna-pro");
    await ui.press("TAB");
    f = await ui.waitFor((x) => x.includes("⚑ ≥272K prompt tokens"), "pricing tab");
    await ui.press("TAB");
    f = await ui.waitFor((x) => x.includes("openai/flex"), "endpoints tab");
    expect(f).toContain("UPTIME 30M");
    expect(f).toContain("CLI: orctl models endpoints openai/gpt-6-luna-pro");
    await ui.escape();
    await ui.waitFor((x) => x.includes("of 16"), "back to list");
  });

  test("providers screen with detail panel", async () => {
    ui = await renderTui(h, { screen: "providers", width: 140 });
    await ui.waitFor((x) => x.includes("Anthropic"), "providers");
    await ui.press("/");
    await ui.type("cere");
    await ui.enter();
    const f = await ui.waitFor((x) => x.includes("status.cerebras.ai"), "detail");
    expect(f).toContain("CLI: orctl providers show cerebras");
  });
});
