import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { apiError, type RecordedRequest } from "../fakes/fetcher.ts";
import { type Harness, harness } from "../helpers.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "public", name), "utf8"));

let h: Harness;
beforeEach(() => {
  h = harness();
  h.fetcher
    .get("/models", fixture("models.json"))
    .get("/providers", fixture("providers.json"))
    .get("/models/openai/gpt-6-luna-pro/endpoints", fixture("endpoints-openai__gpt-6-luna-pro.json"));
});
afterEach(() => h.cleanup());

describe("models list (plan §8.3, §8.4)", () => {
  test("works without any profile and sends no Authorization", async () => {
    const r = await h.cli(["models", "list"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("16 models");
    expect(h.fetcher.calls.every((c) => c.headers.authorization === undefined)).toBe(true);
  });

  test("golden table: sorted by input price with free, variable and tiered flags", async () => {
    const r = await h.cli([
      "models",
      "list",
      "--sort",
      "price",
      "--columns",
      "id,in,out,cache,context,flags",
    ]);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^ID\s+IN \$\/M\s+OUT \$\/M\s+CACHE \$\/M\s+CONTEXT$/);
    const body = lines.slice(1, -1).map((l) => l.replace(/\s+/g, " "));
    expect(body[0]).toMatch(
      /^(nex-agi\/nex-n2.5-mini:free|stealth\/space-bunny-alpha) free free — \S+ FREE$/,
    );
    expect(body.find((l) => l.startsWith("ibm-granite/granite-4.0-h-micro"))).toContain("$0.017");
    expect(body.find((l) => l.startsWith("openai/gpt-6-luna-pro "))).toMatch(/\$0.1 \$0.5 \$0.01 1.05M ⚑$/);
    expect(body[body.length - 1]).toMatch(/^openrouter\/auto variable variable — \S+ VAR$/);
  });

  test("local filters: price ceiling excludes variable models; free; param; context; author; q", async () => {
    const cheap = JSON.parse((await h.cli(["models", "list", "--max-price", "0.2", "--json"])).stdout).data
      .models;
    expect(cheap.some((m: { id: string }) => m.id === "openrouter/auto")).toBe(false);
    expect(
      cheap.every((m: { price: { inputPerMillion: string } }) => Number(m.price.inputPerMillion) <= 0.2),
    ).toBe(true);
    const free = JSON.parse((await h.cli(["models", "list", "--free", "--json"])).stdout).data.models;
    expect(free.map((m: { id: string }) => m.id).sort()).toEqual([
      "nex-agi/nex-n2.5-mini:free",
      "stealth/space-bunny-alpha",
    ]);
    const tools = JSON.parse(
      (await h.cli(["models", "list", "--param", "tools,reasoning", "--author", "openai", "--json"])).stdout,
    ).data;
    expect(tools.models.every((m: { id: string }) => m.id.startsWith("openai/"))).toBe(true);
    const q = JSON.parse((await h.cli(["models", "list", "--q", "gpt luna", "--json"])).stdout).data;
    expect(q.models.map((m: { id: string }) => m.id)).toEqual([
      "openai/gpt-6-luna-pro",
      "openai/gpt-6-luna",
      "openai/gpt-6-luna:batch",
    ]);
    // one network call total: every query above was served from the disk cache
    expect(h.fetcher.callsTo("GET", "/models").length).toBe(1);
  });

  test("JSON prices are exact decimal strings", async () => {
    const r = JSON.parse((await h.cli(["models", "list", "--q", "granite", "--json"])).stdout);
    expect(r.data.models[0].price.inputPerMillion).toBe("0.017");
    expect(r.meta.cached).toBe(false);
    const again = JSON.parse((await h.cli(["models", "list", "--q", "granite", "--json"])).stdout);
    expect(again.meta.cached).toBe(true);
  });

  test("server-side filters go to the API with their parameters", async () => {
    h.fetcher.get("/models", (req: RecordedRequest) => {
      expect(req.query).toMatchObject({ zdr: "true", region: "eu", sort: "most-popular" });
      return new Response(JSON.stringify(fixture("models.json")), {
        headers: { "content-type": "application/json" },
      });
    });
    const r = await h.cli([
      "models",
      "list",
      "--zdr",
      "--region",
      "eu",
      "--sort",
      "popular",
      "--limit",
      "3",
      "--json",
    ]);
    expect(JSON.parse(r.stdout).data.models.length).toBe(3);
  });

  test("--offline without cache is exit 10; with cache it works; --refresh refetches", async () => {
    expect((await h.cli(["models", "list", "--offline"])).code).toBe(10);
    await h.cli(["models", "list"]);
    expect((await h.cli(["models", "list", "--offline"])).code).toBe(0);
    await h.cli(["models", "list", "--refresh"]);
    expect(h.fetcher.callsTo("GET", "/models").length).toBe(2);
  });

  test("cache TTL is 10 minutes (fake clock); cache holds only public data", async () => {
    await h.cli(["models", "list"]);
    h.clock.advance(9 * 60_000);
    await h.cli(["models", "list"]);
    expect(h.fetcher.callsTo("GET", "/models").length).toBe(1);
    h.clock.advance(2 * 60_000);
    await h.cli(["models", "list"]);
    expect(h.fetcher.callsTo("GET", "/models").length).toBe(2);
    expect(readdirSync(join(h.dir, "cache", "orctl", "v1")).sort()).toEqual(["models.json"]);
  });

  test("stale cache is served when the network fails", async () => {
    await h.cli(["models", "list"]);
    h.clock.advance(60 * 60_000);
    h.fetcher.get("/models", () => {
      throw new TypeError("fetch failed");
    });
    const r = await h.cli(["models", "list"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("cached model data");
  });

  test("CSV output", async () => {
    const r = await h.cli(["models", "list", "--q", "granite", "--csv"]);
    expect(r.stdout.split("\n")[0]).toBe("id,name,in,out,cache,context,flags");
    expect(r.stdout).toContain("ibm-granite/granite-4.0-h-micro");
  });
});

describe("models show / endpoints, providers", () => {
  test("show uses the cache, prints tiers", async () => {
    await h.cli(["models", "list"]);
    const r = await h.cli(["models", "show", "openai/gpt-6-luna-pro"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("⚑ ≥272K prompt tokens: input $0.2/M · output $0.75/M");
    expect(r.stdout).toContain("search       $0.01/search");
    expect(h.fetcher.callsTo("GET", /^\/model\//).length).toBe(0);
  });

  test("show falls back to GET /model/{author}/{slug}; unknown ids suggest near matches", async () => {
    h.fetcher.get("/model/openai/gpt-6-luna", { data: fixture("models.json").data[3] });
    expect((await h.cli(["models", "show", "openai/gpt-6-luna"])).code).toBe(0);
    h.fetcher.get("/model/openai/gpt-6-lunar", () => apiError(404, "not found"));
    const r = await h.cli(["models", "show", "openai/gpt-6-lunar"]);
    expect(r.code).toBe(5);
    expect(r.stderr).toContain("Did you mean: openai/gpt-6-luna");
    expect((await h.cli(["models", "show", "nonsense"])).code).toBe(2);
  });

  test("endpoints table sorted by price with uptime", async () => {
    const r = await h.cli(["models", "endpoints", "openai/gpt-6-luna-pro", "--sort", "price"]);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines[0]).toBe("OpenAI: GPT-6 Luna Pro (openai/gpt-6-luna-pro)");
    expect(lines[2]).toMatch(/^OpenAI\s+openai\/flex\s+\$0.05\s+\$0.25/);
    expect(r.stdout).toContain("degraded (-5)");
  });

  test("providers list and show", async () => {
    const list = await h.cli(["providers", "list", "--q", "open"]);
    expect(list.stdout).toContain("openai");
    const show = await h.cli(["providers", "show", "cerebras"]);
    expect(show.stdout).toContain("https://status.cerebras.ai/");
    const missing = await h.cli(["providers", "show", "cerebra"]);
    expect(missing.code).toBe(5);
    expect(missing.stderr).toContain("cerebras");
  });
});
