import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OrctlError } from "../../src/core/errors.ts";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { WS_RESEARCH } from "../fixtures/auth.ts";
import { KeyServer } from "../fixtures/key-server.ts";
import { type Harness, harness, scriptedPrompter } from "../helpers.ts";

let h: Harness;
let server: KeyServer;
beforeEach(async () => {
  h = harness();
  server = new KeyServer(h.fetcher, () => h.clock.now());
  await h.cli(["profile", "add", "acme", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
});
afterEach(() => h.cleanup());

const posts = () => h.fetcher.callsTo("POST", "/keys");

describe("keys create (plan §7.2, §9)", () => {
  test("--store: one POST, second-precision expiry, workspace, key only in the Keychain", async () => {
    const r = await h.cli([
      "keys",
      "create",
      "ci-bot",
      "--limit",
      "50",
      "--reset",
      "monthly",
      "--expires",
      "30d",
      "--workspace",
      "research",
      "--store",
    ]);
    expect(r.code).toBe(0);
    expect(posts().length).toBe(1);
    const body = posts()[0]?.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "ci-bot",
      limit: 50,
      limit_reset: "monthly",
      workspace_id: WS_RESEARCH,
    });
    expect(String(body.expires_at)).toStartWith("2026-10-24T12:00:00");
    const created = server.created[0];
    expect(created).toBeDefined();
    const ref = `orctl/acme/keys/ci-bot-${created?.hash.slice(0, 8)}`;
    expect(h.keychain.items.get(ref)?.value).toBe(created?.key);
    expect(r.stdout).toContain(`stored → keychain:${ref}`);
    expect(r.stdout + r.stderr).not.toContain(created?.key ?? "unreachable");
    expect(r.stderr).toContain("→ profile acme · workspace research · keys.create");
    const json = JSON.parse((await h.cli(["keys", "create", "x", "--store", "--json"])).stdout);
    expect(json.data.key).toBeUndefined();
    expect(json.data.storedAt).toStartWith("keychain:orctl/acme/keys/x-");
  });

  test("--show prints the key once; JSON carries it only with --show", async () => {
    const r = await h.cli(["keys", "create", "scratch", "--show"]);
    expect(r.stdout).toContain(`key (shown once): ${server.created[0]?.key}`);
    const json = JSON.parse((await h.cli(["keys", "create", "scratch2", "--show", "--json"])).stdout);
    expect(json.data.key).toBe(server.created[1]?.key);
  });

  test("--copy uses the clipboard and schedules clearing", async () => {
    const r = await h.cli(["keys", "create", "clip", "--copy"]);
    expect(r.code).toBe(0);
    expect(h.clipboard.copies).toEqual([server.created[0]?.key as string]);
    expect(h.clipboard.clearLaterCalls).toBe(1);
    expect(r.stderr).toContain("Clipboard history");
  });

  test("no delivery flag without a terminal: exit 2 and nothing is created", async () => {
    const r = await h.cli(["keys", "create", "nowhere"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--store");
    expect(posts().length).toBe(0);
  });

  test("on a terminal the delivery target is asked", async () => {
    const prompter = scriptedPrompter(["show"]);
    const r = await h.cli(["keys", "create", "asked"], { stdinIsTTY: true, stdoutIsTTY: true, prompter });
    expect(r.code).toBe(0);
    expect(prompter.asked[0]).toContain("shown only once");
    expect(r.stdout).toContain("key (shown once)");
  });

  test("503: exactly one POST, exit 8 (S3)", async () => {
    server.fail("POST", "/keys", { status: 503 });
    const r = await h.cli(["keys", "create", "busy", "--store"]);
    expect(r.code).toBe(8);
    expect(posts().length).toBe(1);
    expect(server.keys.length).toBe(0);
  });

  test("network error after the server created the key: exit 12 and the orphan is named", async () => {
    server.fail("POST", "/keys", "network-after-create");
    const r = await h.cli(["keys", "create", "ghost", "--store"]);
    expect(r.code).toBe(12);
    expect(posts().length).toBe(1);
    expect(r.stderr).toContain("plaintext was never received");
    expect(r.stderr).toContain(`orctl keys rm ${server.created[0]?.hash.slice(0, 12)} --yes`);
    expect(h.keychain.items.size).toBe(1); // only the profile's management key
  });

  test("network error with nothing created: exit 12, told to check", async () => {
    server.fail("POST", "/keys", "network");
    const r = await h.cli(["keys", "create", "ghost", "--store"]);
    expect(r.code).toBe(12);
    expect(r.stderr).toContain("No new key with this name was found");
  });

  test("delivery failure rolls the new key back", async () => {
    h.keychain.write = async () => {
      throw new OrctlError("NO_CREDENTIAL", "Keychain locked");
    };
    const r = await h.cli(["keys", "create", "rollme", "--store"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("The key was deleted again");
    expect(server.byName("rollme").length).toBe(0);
    expect(h.fetcher.callsTo("DELETE", /^\/keys\//).length).toBe(1);
  });

  test("delivery and rollback both fail: shown once on a terminal, exit 12", async () => {
    h.keychain.write = async () => {
      throw new OrctlError("NO_CREDENTIAL", "Keychain locked");
    };
    server.fail("DELETE", "/keys/", { status: 500 });
    const r = await h.cli(["keys", "create", "stuck", "--store"], { stdoutIsTTY: true });
    expect(r.code).toBe(12);
    expect(r.stderr).toContain(`shown ONCE so you can store it: ${server.created[0]?.key}`);
    server.fail("DELETE", "/keys/", { status: 500 });
    const quiet = await h.cli(["keys", "create", "stuck2", "--store"]);
    expect(quiet.code).toBe(12);
    expect(quiet.stderr).not.toContain(server.created[1]?.key ?? "unreachable");
  });
});

describe("keys update / disable / enable / rm", () => {
  beforeEach(() => {
    server.add("ci-bot", { limit: 50, limit_remaining: 50, limit_reset: "monthly" });
  });

  test("update: rename, limit none, reset none, include BYOK", async () => {
    const r = await h.cli([
      "keys",
      "update",
      "ci-bot",
      "--rename",
      "ci",
      "--limit",
      "none",
      "--reset",
      "none",
      "--include-byok-in-limit",
      "true",
    ]);
    expect(r.code).toBe(0);
    const body = h.fetcher.callsTo("PATCH", /^\/keys\//)[0]?.json();
    expect(body).toEqual({ name: "ci", limit: null, limit_reset: null, include_byok_in_limit: true });
    expect(r.stdout).toContain('Updated key "ci"');
    expect((await h.cli(["keys", "update", "ci"])).code).toBe(2);
    expect((await h.cli(["keys", "update", "ci", "--limit", "lots"])).code).toBe(2);
  });

  test("disable and enable", async () => {
    expect((await h.cli(["keys", "disable", "ci-bot"])).stdout).toContain("Disabled key");
    expect(h.fetcher.callsTo("PATCH", /^\/keys\//)[0]?.json()).toEqual({ disabled: true });
    expect((await h.cli(["keys", "enable", "ci-bot"])).code).toBe(0);
    expect(h.fetcher.callsTo("PATCH", /^\/keys\//)[1]?.json()).toEqual({ disabled: false });
  });

  test("rm: --yes required without a terminal; typed name on a terminal", async () => {
    expect((await h.cli(["keys", "rm", "ci-bot"])).code).toBe(2);
    expect(server.keys.length).toBe(1);
    const prompter = scriptedPrompter(["ci-bot"]);
    const r = await h.cli(["keys", "rm", "ci-bot"], { stdinIsTTY: true, stdoutIsTTY: true, prompter });
    expect(r.code).toBe(0);
    expect(prompter.asked[0]).toContain('Delete key "ci-bot"');
    expect(prompter.asked[0]).toContain("in profile acme / workspace default");
    expect(server.keys.length).toBe(0);
  });

  test("Connect/provisioning keys: 403 explains why", async () => {
    server.fail("DELETE", "/keys/", { status: 403 });
    const r = await h.cli(["keys", "rm", "ci-bot", "--yes"]);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain("Connect/OAuth");
  });
});

describe("no plaintext at rest", () => {
  test("state, cache and config never hold a created key", async () => {
    await h.cli(["keys", "create", "a", "--store"]);
    await h.cli(["keys", "create", "b", "--show"]);
    const walk = (d: string): string[] => {
      try {
        return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [readFileSync(join(d, e.name), "utf8")],
        );
      } catch {
        return [];
      }
    };
    const text = [
      ...walk(join(h.dir, "state")),
      ...walk(join(h.dir, "cache")),
      ...walk(join(h.dir, "config")),
    ].join("\n");
    for (const c of server.created) expect(text).not.toContain(c.key);
  });
});
