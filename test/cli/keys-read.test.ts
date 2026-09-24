import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { apiError } from "../fakes/fetcher.ts";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { WS_RESEARCH } from "../fixtures/auth.ts";
import { LAPTOP_HASH, serveKeys } from "../fixtures/keys.ts";
import { type Harness, harness } from "../helpers.ts";

let h: Harness;
beforeEach(() => {
  h = harness({ env: { ORCTL_MANAGEMENT_KEY: FAKE_MGMT_KEY } });
});
afterEach(() => h.cleanup());

describe("keys list across workspaces (plan §8.2)", () => {
  test("walks every workspace with offset pagination; dedupes; sorts by workspace then name", async () => {
    serveKeys(h.fetcher);
    const r = await h.cli(["keys", "list", "--json"]);
    const env = JSON.parse(r.stdout);
    expect(env.ok).toBe(true);
    expect(
      env.data.keys.map((k: { workspaceSlug: string; name: string }) => `${k.workspaceSlug}/${k.name}`),
    ).toEqual([
      "default/ci-bot",
      "default/laptop",
      "prod/api-server",
      "research/ci-bot",
      "research/notebook",
    ]);
    expect(env.meta.workspaces).toBe(3);
    // default workspace had 2 active keys → a full page, then an empty page
    const defaultCalls = h.fetcher
      .callsTo("GET", "/keys")
      .filter((c) => c.query.workspace_id === "00000000-0000-4000-8000-000000000001");
    expect(defaultCalls.map((c) => c.query.offset ?? "0")).toEqual(["0", "2"]);
    expect(h.fetcher.calls.every((c) => c.headers.authorization === `Bearer ${FAKE_MGMT_KEY}`)).toBe(true);
  });

  test("table view with limit, expiry and status columns", async () => {
    serveKeys(h.fetcher);
    const r = await h.cli(["keys", "list", "--include-disabled"]);
    expect(r.code).toBe(0);
    const line = (name: string) => r.stdout.split("\n").find((l) => l.startsWith(name)) ?? "";
    expect(line("ci-bot")).toMatch(
      /…\w{4}\s+default\s+\$50.00 \/ \$5.00\s+monthly\s+\$45.00\s+never\s+active/,
    );
    expect(line("laptop")).toContain("in 7d");
    expect(line("old")).toContain("disabled");
    expect(r.stdout).toContain("6 keys across 3 workspaces");
  });

  test("--workspace narrows to one workspace by slug", async () => {
    serveKeys(h.fetcher);
    const env = JSON.parse((await h.cli(["keys", "list", "--workspace", "research", "--json"])).stdout);
    expect(env.data.keys.length).toBe(2);
    expect(h.fetcher.callsTo("GET", "/keys").every((c) => c.query.workspace_id === WS_RESEARCH)).toBe(true);
  });

  test("partial failure: warning and exit 0, or exit 11 with --strict", async () => {
    serveKeys(h.fetcher, { failWorkspace: WS_RESEARCH });
    const r = await h.cli(["keys", "list"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("Workspace research");
    expect(r.stdout).toContain("missing: research");
    const strict = await h.cli(["keys", "list", "--strict", "--json"]);
    expect(strict.code).toBe(11);
    expect(JSON.parse(strict.stdout).meta.partial).toEqual(["research"]);
  });

  test("falls back to the default workspace when workspaces are unavailable", async () => {
    serveKeys(h.fetcher);
    h.fetcher.get("/workspaces", () => apiError(403, "forbidden"));
    const r = await h.cli(["keys", "list"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("default workspace only");
    expect(r.stdout).toContain("2 keys across 1 workspace");
  });

  test("user-only profile gets exit 3 with the fix, without calling the API", async () => {
    const u = harness({ env: { ORCTL_USER_KEY: "sk-or-v1-FAKEUSERONLY0000000000000000" } });
    try {
      const r = await u.cli(["keys", "list"]);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain("--mgmt-key-stdin");
      expect(u.fetcher.calls.length).toBe(0);
    } finally {
      u.cleanup();
    }
  });
});

describe("key references (plan §7.4)", () => {
  beforeEach(() => serveKeys(h.fetcher));

  test("full hash, hash prefix, unique name, label suffix", async () => {
    const show = async (ref: string) => JSON.parse((await h.cli(["keys", "show", ref, "--json"])).stdout);
    expect((await show(LAPTOP_HASH)).data.name).toBe("laptop");
    expect((await show("abc123")).data.name).toBe("notebook");
    expect((await show("api-server")).data.workspaceSlug).toBe("prod");
    expect((await show("…1c96")).data.name).toBe("laptop");
    expect((await show("sk-or-v1-6c6...1c96")).data.name).toBe("laptop");
  });

  test("ambiguous name lists candidates (exit 2); unknown suggests (exit 5)", async () => {
    const amb = await h.cli(["keys", "show", "ci-bot"]);
    expect(amb.code).toBe(2);
    expect(amb.stderr).toContain("matches 2 keys");
    expect(amb.stderr).toContain("research");
    const json = JSON.parse((await h.cli(["keys", "show", "ci-bot", "--json"])).stdout);
    expect(json.error.details.candidates.length).toBe(2);
    const scoped = JSON.parse(
      (await h.cli(["keys", "show", "ci-bot", "--workspace", "research", "--json"])).stdout,
    );
    expect(scoped.data.workspaceSlug).toBe("research");
    const unknown = await h.cli(["keys", "show", "laptpo"]);
    expect(unknown.code).toBe(5);
    expect(unknown.stderr).toContain("laptop");
  });

  test("keys show detail view", async () => {
    const r = await h.cli(["keys", "show", "ci-bot", "--workspace", "default"]);
    expect(r.stdout).toContain("Limit      $50.00 monthly · left $5.00");
    expect(r.stdout).toMatch(/Hash\s+[0-9a-f]{64}/);
  });
});

describe("credits", () => {
  test("computes what is left", async () => {
    serveKeys(h.fetcher);
    const r = await h.cli(["credits"]);
    expect(r.stdout).toContain("Credits  $50.00");
    expect(r.stdout).toContain("Left     $12.40");
    expect(r.stdout).toContain("75% used");
    expect(JSON.parse((await h.cli(["credits", "--json"])).stdout).data.remaining).toBeCloseTo(12.4);
  });
});
