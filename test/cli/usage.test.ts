import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { ACTIVITY_ROWS, serveActivity } from "../fixtures/activity.ts";
import { WS_RESEARCH } from "../fixtures/auth.ts";
import { LAPTOP_HASH, serveKeys } from "../fixtures/keys.ts";
import { type Harness, harness } from "../helpers.ts";

let h: Harness;
beforeEach(() => {
  h = harness({ env: { ORCTL_MANAGEMENT_KEY: FAKE_MGMT_KEY } });
  serveKeys(h.fetcher);
  serveActivity(h.fetcher);
});
afterEach(() => h.cleanup());

const data = async (...args: string[]) => JSON.parse((await h.cli(["usage", ...args, "--json"])).stdout).data;

describe("usage report (plan §8.5)", () => {
  test("default: by model over the last 30 days, sorted by spend; totals equal the raw rows", async () => {
    const r = await h.cli(["usage"]);
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n");
    expect(lines[0]).toMatch(/^MODEL\s+USAGE\s+SHARE/);
    expect(lines[1]).toMatch(/^anthropic\/claude-sonnet-5\s+\$25.00\s+77%/);
    expect(lines[2]).toMatch(/^openai\/gpt-6-luna\s+\$7.50\s+23%/);
    const inWindow = ACTIVITY_ROWS.filter((x) => x.date >= "2026-08-25");
    const total = inWindow.reduce((s, x) => s + x.usage, 0);
    expect(r.stdout).toContain(`Total  $${total.toFixed(2)}`);
    expect(r.stdout).toContain("2026-08-25 … 2026-09-24 (UTC)");
    const d = await data();
    expect(d.totals.requests).toBe(inWindow.reduce((s, x) => s + x.requests, 0));
    expect(d.rows[0].share + d.rows[1].share).toBeCloseTo(1);
  });

  test("--days 7 and --since/--until filter locally; one API call per run", async () => {
    const week = await data("--days", "7");
    expect(week.since).toBe("2026-09-17");
    expect(week.rows[0].usage).toBe(5 + 6 + 7);
    const range = await data("--since", "2026-09-10", "--until", "2026-09-18", "--by", "day");
    expect(range.rows.map((r: { group: string }) => r.group)).toEqual(["2026-09-10", "2026-09-18"]);
    expect(h.fetcher.callsTo("GET", "/activity").length).toBe(2);
  });

  test("windows beyond 30 days are a usage error", async () => {
    const r = await h.cli(["usage", "--since", "2026-08-01"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("only returns the last 30 days");
    expect((await h.cli(["usage", "--days", "31"])).code).toBe(2);
    expect((await h.cli(["usage", "--days", "7", "--since", "2026-09-01"])).code).toBe(2);
  });

  test("--by provider, --by workspace (group_by=workspace, slugs)", async () => {
    const prov = await data("--by", "provider");
    expect(prov.rows.map((r: { group: string }) => r.group)).toEqual(["Anthropic", "OpenAI", "Azure"]);
    const ws = await data("--by", "workspace");
    expect(ws.rows.map((r: { group: string }) => r.group)).toEqual(["default", "research"]);
    expect(h.fetcher.callsTo("GET", "/activity").some((c) => c.query.group_by === "workspace")).toBe(true);
  });

  test("--key filters activity by hash; --workspace by id", async () => {
    const k = await data("--key", "laptop");
    expect(h.fetcher.callsTo("GET", "/activity").at(-1)?.query.api_key_hash).toBe(LAPTOP_HASH);
    expect(k.rows.map((r: { group: string }) => r.group)).toEqual(["openai/gpt-6-luna"]);
    await data("--workspace", "research");
    expect(h.fetcher.callsTo("GET", "/activity").at(-1)?.query.workspace_id).toBe(WS_RESEARCH);
  });

  test("--by key uses key counters and says so", async () => {
    const r = await h.cli(["usage", "--by", "key"]);
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")[0]).toMatch(/^KEY\s+WORKSPACE\s+TODAY\s+WEEK\s+MONTH\s+ALL TIME/);
    expect(r.stdout.split("\n")[1]).toMatch(/^ci-bot\s+default/);
    expect(r.stdout).toContain("per-key usage counters");
    expect(h.fetcher.callsTo("GET", "/activity").length).toBe(0);
    expect((await data("--by", "key")).source).toBe("key-counters");
  });

  test("CSV", async () => {
    const r = await h.cli(["usage", "--by", "provider", "--csv"]);
    expect(r.stdout.split("\n")[0]).toBe("group,usage,share,bar,requests,prompt,completion,reasoning");
    expect(r.stdout.split("\n")[1]).toStartWith("Anthropic,$25.00,77%,");
  });
});
