import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { OrctlError } from "../../src/core/errors.ts";
import { requestInterrupt } from "../../src/core/interrupt.ts";
import { json, type RecordedRequest } from "../fakes/fetcher.ts";
import { FAKE_MGMT_KEY, FAKE_USER_KEY } from "../fakes/keys.ts";
import { KeyServer } from "../fixtures/key-server.ts";
import { type Harness, harness, scriptedPrompter } from "../helpers.ts";

let h: Harness;
let server: KeyServer;
const OLD_HASH = `${"b".repeat(60)}0c96`;

beforeEach(async () => {
  h = harness();
  server = new KeyServer(h.fetcher, () => h.clock.now());
  server.add("ci-bot", {
    hash: OLD_HASH,
    label: "sk-or-v1-bbb...0c96",
    limit: 50,
    limit_remaining: 20,
    limit_reset: "monthly",
    created_at: "2026-06-26T12:00:00Z",
    expires_at: "2026-12-24T12:00:00Z",
  });
  await h.cli(["profile", "add", "acme", "--mgmt-key-stdin"], { stdin: FAKE_MGMT_KEY });
});
afterEach(() => h.cleanup());

const journals = () => {
  try {
    return readdirSync(join(h.dir, "state", "orctl", "rotations"));
  } catch {
    return [];
  }
};
const old = () => server.keys.find((k) => k.hash === OLD_HASH);

describe("keys rotate (plan §8.1)", () => {
  test("needs --yes without a terminal", async () => {
    const r = await h.cli(["keys", "rotate", "ci-bot", "--store"]);
    expect(r.code).toBe(2);
    expect(server.created.length).toBe(0);
  });

  test("happy path: create same limits → Keychain → verify → rename + disable old; journal removed", async () => {
    const r = await h.cli(["keys", "rotate", "ci-bot", "--store", "--yes"]);
    expect(r.code).toBe(0);
    const created = server.created[0];
    expect(created).toBeDefined();
    const body = h.fetcher.callsTo("POST", "/keys")[0]?.json() as Record<string, unknown>;
    expect(body).toMatchObject({ name: "ci-bot", limit: 50, limit_reset: "monthly" });
    expect(String(body.expires_at)).toStartWith("2027-03-24T12:00:00");
    expect(h.keychain.items.get(`orctl/acme/keys/ci-bot-${created?.hash.slice(0, 8)}`)?.value).toBe(
      created?.key,
    );
    const verify = h.fetcher
      .callsTo("GET", "/key")
      .find((c) => c.headers.authorization === `Bearer ${created?.key}`);
    expect(verify).toBeDefined();
    expect(old()).toMatchObject({ name: "ci-bot (rotated 2026-09-24)", disabled: true });
    expect(journals()).toEqual([]);
    expect(r.stdout).toContain("verified with GET /key: yes");
    expect(r.stdout).toContain('renamed to "ci-bot (rotated 2026-09-24)" and disabled');
    expect(r.stderr).toContain("start from zero");
    expect(r.stdout + r.stderr).not.toContain(created?.key ?? "unreachable");
  });

  test("the profile's own user key is updated in place in its Keychain item", async () => {
    await h.cli(["profile", "set", "acme", "--user-key-stdin", "--no-verify"], { stdin: FAKE_USER_KEY });
    h.fetcher.get("/key", (req: RecordedRequest) =>
      req.headers.authorization === `Bearer ${FAKE_USER_KEY}`
        ? json({ data: { ...userKeyExtras, label: "sk-or-v1-bbb...0c96" } })
        : json({ data: { ...userKeyExtras, label: "new" } }),
    );
    const r = await h.cli(["keys", "rotate", "ci-bot", "--yes"]);
    expect(r.code).toBe(0);
    expect(h.keychain.items.get("orctl/acme/user")?.value).toBe(server.created[0]?.key);
    expect(r.stdout).toContain("stored → keychain:orctl/acme/user");
  });

  test("without a delivery flag and not the profile key: exit 2 without a terminal, asked on one", async () => {
    expect((await h.cli(["keys", "rotate", "ci-bot", "--yes"])).code).toBe(2);
    const prompter = scriptedPrompter([true, "show"]);
    const r = await h.cli(["keys", "rotate", "ci-bot"], { stdinIsTTY: true, stdoutIsTTY: true, prompter });
    expect(r.code).toBe(0);
    expect(prompter.asked[0]).toContain('Rotate key "ci-bot"');
    expect(prompter.asked[1]).toContain("shown only once");
    expect(r.stdout).toContain(`key (shown once): ${server.created[0]?.key}`);
  });

  test("--keep-old-enabled only renames; --no-verify skips GET /key", async () => {
    const r = await h.cli([
      "keys",
      "rotate",
      "ci-bot",
      "--copy",
      "--keep-old-enabled",
      "--no-verify",
      "--yes",
    ]);
    expect(r.code).toBe(0);
    expect(h.fetcher.callsTo("PATCH", /^\/keys\//)[0]?.json()).toEqual({
      name: "ci-bot (rotated 2026-09-24)",
    });
    expect(old()?.disabled).toBe(false);
    expect(h.fetcher.callsTo("GET", "/key").length).toBe(0);
  });

  test("--delete-old asks for the old key's name on a terminal", async () => {
    const prompter = scriptedPrompter(["ci-bot"]);
    const r = await h.cli(["keys", "rotate", "ci-bot", "--store", "--delete-old"], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      prompter,
    });
    expect(r.code).toBe(0);
    expect(prompter.asked[0]).toContain('Type "ci-bot"');
    expect(old()).toBeUndefined();
  });

  test("unknown create outcome: exit 12, orphan named, journal kept and explained by doctor", async () => {
    server.fail("POST", "/keys", "network-after-create");
    const r = await h.cli(["keys", "rotate", "ci-bot", "--store", "--yes"]);
    expect(r.code).toBe(12);
    expect(r.stderr).toContain("plaintext was never received");
    expect(old()?.disabled).toBe(false);
    expect(journals().length).toBe(1);
    h.fetcher.get("/models/count", { data: { count: 1 } });
    const d = await h.cli(["doctor", "--offline"]);
    expect(d.stdout).toContain('Unfinished rotation of "ci-bot"');
    expect(d.stdout).toContain("may exist without a usable plaintext");
    const again = await h.cli(["keys", "rotate", "ci-bot", "--store", "--yes"]);
    expect(again.stderr).toContain('An earlier rotation of "ci-bot" is unfinished');
  });

  test("delivery failure deletes the new key; old key untouched; journal removed", async () => {
    h.keychain.write = async () => {
      throw new OrctlError("NO_CREDENTIAL", "Keychain locked");
    };
    const r = await h.cli(["keys", "rotate", "ci-bot", "--store", "--yes"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("The new key was deleted; the old key is unchanged");
    expect(server.keys.length).toBe(1);
    expect(old()?.disabled).toBe(false);
    expect(journals()).toEqual([]);
  });

  test("verification failure: new key kept, old key left active, exit 4, doctor says what next", async () => {
    server.fail("GET", "/key", { status: 401 });
    const r = await h.cli(["keys", "rotate", "ci-bot", "--store", "--yes"]);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain("the old key was left active");
    expect(r.stderr).toContain(`orctl keys disable ${OLD_HASH.slice(0, 12)}`);
    expect(old()?.disabled).toBe(false);
    expect(server.keys.length).toBe(2);
    expect(journals().length).toBe(1);
  });

  test("retiring the old key fails: exit 8, new key in place, journal open", async () => {
    server.fail("PATCH", "/keys/", { status: 500 });
    const r = await h.cli(["keys", "rotate", "ci-bot", "--store", "--yes"]);
    expect(r.code).toBe(8);
    expect(r.stderr).toContain("updating the old key failed");
    expect(journals().length).toBe(1);
  });

  test("SIGINT stops at the next step boundary with the journal kept (exit 130)", async () => {
    h.keychain.write = async (ref, secret, label) => {
      requestInterrupt();
      h.keychain.items.set(
        `${(ref as { service: string }).service}/${(ref as { account: string }).account}`,
        {
          value: secret.reveal(),
          label,
        },
      );
    };
    const r = await h.cli(["keys", "rotate", "ci-bot", "--store", "--yes"]);
    expect(r.code).toBe(130);
    expect(r.stderr).toContain("interrupted");
    expect(old()?.disabled).toBe(false);
    expect(journals().length).toBe(1);
  });
});

const userKeyExtras = {
  limit: null,
  limit_remaining: null,
  limit_reset: null,
  usage: 0,
  usage_daily: 0,
  usage_weekly: 0,
  usage_monthly: 0,
  byok_usage: 0,
  byok_usage_daily: 0,
  byok_usage_weekly: 0,
  byok_usage_monthly: 0,
  include_byok_in_limit: false,
  is_free_tier: false,
  is_management_key: false,
  is_provisioning_key: false,
  allowed_data_regions: ["global"],
  creator_user_id: null,
  expires_at: null,
  free_model_daily_requests: { limit: 1000, remaining: 1000, used: 0 },
  organization_id: null,
  rate_limit: { interval: "10s", note: "deprecated", requests: -1 },
  workspace_id: null,
};
