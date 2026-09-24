import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { apiError } from "../fakes/fetcher.ts";
import { FAKE_MGMT_KEY, FAKE_OTHER_MGMT_KEY, FAKE_USER_KEY } from "../fakes/keys.ts";
import { credits, currentKey, workspaces } from "../fixtures/auth.ts";
import { type Harness, harness, scriptedPrompter } from "../helpers.ts";

let h: Harness;
beforeEach(() => {
  h = harness();
  h.fetcher.get("/credits", credits()).get("/workspaces", workspaces()).get("/key", currentKey());
});
afterEach(() => h.cleanup());

const readConfig = () => readFileSync(h.env.ORCTL_CONFIG as string, "utf8");

describe("profile add (plan §6.8)", () => {
  test("--mgmt-key-stdin verifies, stores in the Keychain and writes only a reference", async () => {
    const r = await h.cli(["profile", "add", "personal", "--mgmt-key-stdin", "--color", "green"], {
      stdin: `${FAKE_MGMT_KEY}\n`,
    });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Verified: management role · credits $50.00 / used $37.60");
    expect(r.stdout).toContain("keychain:orctl/personal/management");
    expect(h.keychain.items.get("orctl/personal/management")?.value).toBe(FAKE_MGMT_KEY);
    const cfg = readConfig();
    expect(cfg).toContain('management_key = "keychain:orctl/personal/management"');
    expect(cfg).toContain('default_profile = "personal"');
    expect(cfg).not.toContain("sk-or-");
    expect(h.fetcher.callsTo("GET", "/credits")[0]?.headers.authorization).toBe(`Bearer ${FAKE_MGMT_KEY}`);
  });

  test("a rejected key is not saved unless --no-verify", async () => {
    h.fetcher.get("/credits", () => apiError(401, "Invalid management key"));
    const r = await h.cli(["profile", "add", "bad", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
    expect(r.code).toBe(4);
    expect(r.stderr).toContain("management key verification failed");
    expect(r.stderr).toContain("--no-verify");
    expect(existsSync(h.env.ORCTL_CONFIG as string)).toBe(false);
    expect(h.keychain.items.size).toBe(0);
    const ok = await h.cli(["profile", "add", "bad", "--mgmt-key-stdin", "--no-verify"], {
      stdin: FAKE_MGMT_KEY,
    });
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("Not verified");
  });

  test("references are resolved for verification but stored as-is", async () => {
    h.op.values["op://Work/ACME/management key"] = FAKE_OTHER_MGMT_KEY;
    const r = await h.cli([
      "profile",
      "add",
      "acme",
      "--mgmt-key-ref",
      "op://Work/ACME/management key",
      "--color",
      "red",
    ]);
    expect(r.code).toBe(0);
    expect(readConfig()).toContain('management_key = "op://Work/ACME/management key"');
    expect(h.keychain.items.size).toBe(0);
  });

  test("warns when the user key is really a management key", async () => {
    h.fetcher.get("/key", currentKey({ is_management_key: true }));
    const r = await h.cli(["profile", "add", "p", "--user-key-stdin"], { stdin: FAKE_USER_KEY });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("is_management_key=true");
  });

  test("no key at all is a usage error", async () => {
    const r = await h.cli(["profile", "add", "empty"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("management-keys");
  });

  test("key values never go through argv: --mgmt-key is not a flag", async () => {
    const r = await h.cli(["profile", "add", "x", "--mgmt-key", FAKE_MGMT_KEY]);
    expect(r.code).toBe(2);
    expect(r.stdout + r.stderr).not.toContain(FAKE_MGMT_KEY.slice(12));
  });

  test("guided flow on a terminal asks for source, key, workspace, color and default", async () => {
    const prompter = scriptedPrompter(["paste", FAKE_MGMT_KEY, false, "research", "blue", true]);
    const r = await h.cli(["profile", "add", "guided"], { stdinIsTTY: true, stdoutIsTTY: true, prompter });
    expect(r.code).toBe(0);
    expect(prompter.asked).toEqual([
      "Management key source",
      "Management key",
      "Add a user (inference) key for whoami/limits?",
      "Default workspace",
      "Color",
      "Make default?",
    ]);
    const cfg = readConfig();
    expect(cfg).toContain('workspace = "research"');
    expect(cfg).toContain('color = "blue"');
  });

  test("Nix-managed config: secret still stored, TOML to add printed, exit 2", async () => {
    const target = join(h.dir, "nix-config.toml");
    writeFileSync(target, "version = 1\n");
    mkdirSync(dirname(h.env.ORCTL_CONFIG as string), { recursive: true });
    symlinkSync(target, h.env.ORCTL_CONFIG as string);
    const r = await h.cli(["profile", "add", "nixp", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("[profiles.nixp]");
    expect(h.keychain.items.get("orctl/nixp/management")?.value).toBe(FAKE_MGMT_KEY);
    expect(readFileSync(target, "utf8")).toBe("version = 1\n");
  });
});

describe("profile list/show/use/set/rename/rm", () => {
  beforeEach(async () => {
    await h.cli(
      ["profile", "add", "personal", "--mgmt-key-stdin", "--label", "Kişisel", "--color", "green"],
      { stdin: FAKE_MGMT_KEY },
    );
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
  });

  test("list shows the table with the active profile marked", async () => {
    const r = await h.cli(["profile", "list"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/●\s+personal\s+Kişisel/);
    expect(r.stdout).toContain("op://Work/ACME/management key");
  });

  test("list --verify probes each profile", async () => {
    const r = await h.cli(["profile", "list", "--verify"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("M ✔");
  });

  test("use switches via state.json; JSON meta reports the source", async () => {
    expect((await h.cli(["profile", "use", "acme"])).code).toBe(0);
    const r = await h.cli(["profile", "show", "--json"]);
    const env = JSON.parse(r.stdout);
    expect(env.ok).toBe(true);
    expect(env.data.name).toBe("acme");
    expect(env.meta.profile).toBe("acme");
    expect(env.meta.profile_source).toBe("state");
    expect((await h.cli(["profile", "use", "ghost"])).code).toBe(5);
  });

  test("set changes metadata and can drop a key reference", async () => {
    const r = await h.cli([
      "profile",
      "set",
      "acme",
      "--label",
      "ACME org",
      "--no-mgmt-key",
      "--user-key-ref",
      "env:ACME_USER",
      "--no-verify",
    ]);
    expect(r.code).toBe(0);
    const cfg = readConfig();
    expect(cfg).toContain('label = "ACME org"');
    expect(cfg).toContain('user_key = "env:ACME_USER"');
    expect(cfg).not.toContain("op://Work/ACME");
  });

  test("rename moves default-named Keychain items (read → write → delete)", async () => {
    const r = await h.cli(["profile", "rename", "personal", "home"]);
    expect(r.code).toBe(0);
    expect(h.keychain.items.has("orctl/personal/management")).toBe(false);
    expect(h.keychain.items.get("orctl/home/management")?.value).toBe(FAKE_MGMT_KEY);
    expect(readConfig()).toContain('default_profile = "home"');
    expect(h.keychain.log.filter((l) => !l.startsWith("read"))).toEqual([
      "write keychain:orctl/personal/management",
      "write keychain:orctl/home/management",
      "delete keychain:orctl/personal/management",
    ]);
  });

  test("rm requires --yes without a terminal; --purge-secrets deletes Keychain items", async () => {
    const refused = await h.cli(["profile", "rm", "personal"]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("--yes");
    const r = await h.cli(["profile", "rm", "personal", "--purge-secrets", "--yes"]);
    expect(r.code).toBe(0);
    expect(h.keychain.items.size).toBe(0);
    expect(readConfig()).not.toContain("[profiles.personal]");
    expect(readConfig()).toContain('default_profile = "acme"');
  });

  test("rm on a terminal asks for the typed name", async () => {
    const wrong = await h.cli(["profile", "rm", "acme"], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompter: scriptedPrompter(["acm"]),
    });
    expect(wrong.code).toBe(2);
    expect(readConfig()).toContain("[profiles.acme]");
    const right = await h.cli(["profile", "rm", "acme"], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompter: scriptedPrompter(["acme"]),
    });
    expect(right.code).toBe(0);
  });
});

describe("whoami and doctor (plan §6.9)", () => {
  test("whoami shows both roles without key values", async () => {
    await h.cli(["profile", "add", "personal", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
    await h.cli(["profile", "set", "personal", "--user-key-ref", "env:MY_USER_KEY", "--no-verify"]);
    h.env.MY_USER_KEY = FAKE_USER_KEY;
    const r = await h.cli(["whoami"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("personal (selected via config)");
    expect(r.stdout).toContain("role verified · credits $50.00 · used $37.60 · left $12.40");
    expect(r.stdout).toContain("sk-or-v1-0e6...1c96 · limit $20.00 monthly · left $8.10 · free-tier no");
    expect(r.stdout).toContain("3 visible");
    expect(r.stdout + r.stderr).not.toContain(FAKE_MGMT_KEY);
    expect((await h.cli(["auth", "whoami", "--json"])).stdout).toContain('"op": "auth.whoami"');
  });

  test("whoami reports a partial result when one probe fails", async () => {
    await h.cli(["profile", "add", "p", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
    await h.cli(["profile", "set", "p", "--user-key-ref", "env:NOT_SET", "--no-verify"]);
    const r = await h.cli(["whoami"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("NOT_SET");
    expect(r.stdout).toContain("role verified");
  });

  test("ephemeral env profile works without a config", async () => {
    h.env.ORCTL_MANAGEMENT_KEY = FAKE_MGMT_KEY;
    const r = await h.cli(["whoami", "--json"]);
    const env = JSON.parse(r.stdout);
    expect(env.meta.profile).toBe("env");
    expect(env.meta.profile_source).toBe("ephemeral-env");
    expect(env.data.management.credits.remaining).toBeCloseTo(12.4);
    expect(r.stdout).not.toContain(FAKE_MGMT_KEY);
  });

  test("doctor reports unresolvable refs and ignored env vars", async () => {
    h.env.OPENROUTER_API_KEY = FAKE_USER_KEY;
    await h.cli(["profile", "add", "p", "--mgmt-key-ref", "env:GONE", "--no-verify"]);
    h.fetcher.get("/models/count", { data: { count: 458 } });
    const r = await h.cli(["doctor"]);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain("✖ p management: Environment variable GONE");
    expect(r.stdout).toContain("OPENROUTER_API_KEY is set but ignored");
    expect(r.stdout).toContain("openrouter.ai reachable (458 models)");
    expect(r.stdout + r.stderr).not.toContain(FAKE_USER_KEY);
  });

  test("commands needing a key exit 3 with the fix", async () => {
    const r = await h.cli(["whoami"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("orctl profile add");
  });
});
