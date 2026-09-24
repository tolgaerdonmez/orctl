import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Secret } from "../../src/core/secret.ts";
import { createEnvBackend, createFileBackend } from "../../src/core/secrets/env-file.ts";
import { createKeychainBackend, SECURITY_BIN } from "../../src/core/secrets/keychain-macos.ts";
import { createOnePasswordBackend } from "../../src/core/secrets/onepassword.ts";
import { defaultKeychainRef, generatedKeyRef, parseSecretRef } from "../../src/core/secrets/ref.ts";
import { SecretStore } from "../../src/core/secrets/store.ts";
import { FAKE_MGMT_KEY, FAKE_USER_KEY } from "../fakes/keys.ts";
import { fail, fakeRunner, ok } from "../fakes/process.ts";
import { tempHome } from "../helpers.ts";

const homes: Array<{ cleanup(): void }> = [];
afterEach(() => {
  for (const h of homes.splice(0)) h.cleanup();
});

describe("secret references (plan §6.4)", () => {
  test("parses every scheme", () => {
    expect(parseSecretRef("keychain:orctl/personal/management")).toMatchObject({
      scheme: "keychain",
      service: "orctl",
      account: "personal/management",
    });
    expect(parseSecretRef("op://Work/OpenRouter ACME/management key").scheme).toBe("op");
    expect(parseSecretRef("env:ORCTL_X")).toMatchObject({ scheme: "env", name: "ORCTL_X" });
    expect(parseSecretRef("file:~/k.txt")).toMatchObject({ scheme: "file", path: "~/k.txt" });
  });

  test("rejects raw keys, bad shapes and injection characters", () => {
    expect(() => parseSecretRef(FAKE_MGMT_KEY)).toThrow(/raw API key/);
    expect(() => parseSecretRef("keychain:orctl")).toThrow();
    expect(() => parseSecretRef('keychain:orctl/a"b')).toThrow();
    expect(() => parseSecretRef("keychain:orctl/a\nb")).toThrow();
    expect(() => parseSecretRef("op://only-vault")).toThrow();
    expect(() => parseSecretRef("vault:x")).toThrow(/Unknown/);
  });

  test("default and generated Keychain names", () => {
    expect(defaultKeychainRef("acme", "user")).toBe("keychain:orctl/acme/user");
    expect(generatedKeyRef("acme", "CI Bot!", "abcdef0123456789")).toBe(
      "keychain:orctl/acme/keys/ci-bot-abcdef01",
    );
  });
});

describe("macOS Keychain backend (plan §6.5, §9 S4)", () => {
  test("writes through `security -i` stdin, never argv, and verifies by reading back", async () => {
    const stored = new Map<string, string>();
    const { run, calls } = fakeRunner((argv, opts) => {
      if (argv[1] === "-i") {
        const m = opts.stdin?.match(/-a "([^"]+)" -l "[^"]+" -w (\S+)\n$/);
        if (m?.[1] && m[2]) stored.set(m[1], m[2]);
        return ok("security> ");
      }
      if (argv[1] === "find-generic-password") {
        const account = argv[argv.indexOf("-a") + 1] as string;
        const v = stored.get(account);
        return v ? ok(`${v}\n`) : fail(44, "The specified item could not be found in the keychain.");
      }
      return fail(1);
    });
    const kc = createKeychainBackend(run, "darwin");
    const ref = parseSecretRef("keychain:orctl/personal/management");
    await kc.write?.(ref, new Secret(FAKE_MGMT_KEY), "orctl personal management");
    for (const c of calls) {
      expect(c.argv[0]).toBe(SECURITY_BIN);
      expect(c.argv.join(" ")).not.toContain("sk-or-");
    }
    expect(calls[0]?.stdin).toContain(FAKE_MGMT_KEY);
    expect(calls[0]?.stdin).toStartWith('add-generic-password -U -s "orctl" -a "personal/management"');
    expect((await kc.read(ref)).reveal()).toBe(FAKE_MGMT_KEY);
  });

  test("a write that does not read back fails loudly", async () => {
    const { run } = fakeRunner((argv) => (argv[1] === "-i" ? ok() : fail(44)));
    const kc = createKeychainBackend(run, "darwin");
    await expect(
      kc.write?.(parseSecretRef("keychain:orctl/p/management"), new Secret(FAKE_MGMT_KEY), "l"),
    ).rejects.toThrow();
  });

  test("refuses values that are not key-shaped (no stdin injection)", async () => {
    const { run, calls } = fakeRunner(() => ok());
    const kc = createKeychainBackend(run, "darwin");
    await expect(
      kc.write?.(parseSecretRef("keychain:orctl/p/management"), new Secret("sk-or-x\ndelete-keychain"), "l"),
    ).rejects.toThrow();
    expect(calls.length).toBe(0);
  });

  test("missing items map to NO_CREDENTIAL; other platforms are refused", async () => {
    const { run } = fakeRunner(() => fail(44));
    await expect(
      createKeychainBackend(run, "darwin").read(parseSecretRef("keychain:orctl/x/y")),
    ).rejects.toMatchObject({ code: "NO_CREDENTIAL" });
    await expect(
      createKeychainBackend(run, "linux").read(parseSecretRef("keychain:orctl/x/y")),
    ).rejects.toMatchObject({ code: "NO_CREDENTIAL" });
  });
});

describe("1Password, env and file backends", () => {
  test("op read with --no-newline; missing op is NO_CREDENTIAL", async () => {
    const { run, calls } = fakeRunner(() => ok(FAKE_USER_KEY));
    const op = createOnePasswordBackend(run, () => "/opt/bin/op");
    const ref = parseSecretRef("op://Private/OpenRouter/credential");
    expect((await op.read(ref)).reveal()).toBe(FAKE_USER_KEY);
    expect(calls[0]?.argv).toEqual([
      "/opt/bin/op",
      "read",
      "--no-newline",
      "op://Private/OpenRouter/credential",
    ]);
    await expect(createOnePasswordBackend(run, () => null).read(ref)).rejects.toMatchObject({
      code: "NO_CREDENTIAL",
    });
  });

  test("env backend", async () => {
    const env = createEnvBackend({ K: FAKE_USER_KEY });
    expect((await env.read(parseSecretRef("env:K"))).reveal()).toBe(FAKE_USER_KEY);
    await expect(env.read(parseSecretRef("env:MISSING"))).rejects.toMatchObject({ code: "NO_CREDENTIAL" });
  });

  test("file backend requires 0600", async () => {
    const home = tempHome();
    homes.push(home);
    const path = join(home.dir, "key.txt");
    writeFileSync(path, `${FAKE_USER_KEY}\n`);
    chmodSync(path, 0o644);
    const backend = createFileBackend(home.dir);
    await expect(backend.read(parseSecretRef(`file:${path}`))).rejects.toThrow(/0600/);
    chmodSync(path, 0o600);
    expect((await backend.read(parseSecretRef("file:~/key.txt"))).reveal()).toBe(FAKE_USER_KEY);
  });

  test("store memoizes reads and refuses writes to read-only schemes", async () => {
    let reads = 0;
    const { run } = fakeRunner(() => {
      reads++;
      return ok(FAKE_USER_KEY);
    });
    const store = new SecretStore([createOnePasswordBackend(run, () => "op")]);
    await store.resolve("op://a/b/c");
    await store.resolve("op://a/b/c");
    expect(reads).toBe(1);
    await expect(store.write("op://a/b/c", new Secret(FAKE_USER_KEY), "x")).rejects.toMatchObject({
      code: "USAGE",
    });
  });
});
