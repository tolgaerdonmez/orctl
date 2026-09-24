import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ProfileStore } from "../../src/core/profile/config-store.ts";
import { resolveProfile } from "../../src/core/profile/resolve.ts";
import { type ConfigV1, emptyState } from "../../src/core/profile/schema.ts";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { tempHome } from "../helpers.ts";

const homes: Array<{ cleanup(): void }> = [];
afterEach(() => {
  for (const h of homes.splice(0)) h.cleanup();
});

const config: ConfigV1 = {
  version: 1,
  default_profile: "personal",
  profiles: {
    personal: { management_key: "keychain:orctl/personal/management", color: "green" },
    acme: { management_key: "op://Work/ACME/management key", color: "red" },
  },
};

describe("profile selection order (plan §6.6)", () => {
  const state = { ...emptyState(), current_profile: "acme" };
  test.each([
    [
      "flag wins",
      { flag: "personal", env: { ORCTL_PROFILE: "acme", ORCTL_MANAGEMENT_KEY: "x" } },
      "personal",
      "flag",
    ],
    ["ORCTL_PROFILE", { env: { ORCTL_PROFILE: "personal", ORCTL_MANAGEMENT_KEY: "x" } }, "personal", "env"],
    ["ephemeral env profile", { env: { ORCTL_MANAGEMENT_KEY: "x" } }, "env", "ephemeral-env"],
    ["state current_profile", { env: {} }, "acme", "state"],
  ] as const)("%s", (_name, input, expected, source) => {
    const p = resolveProfile({ ...input, config, state });
    expect(p?.name).toBe(expected);
    expect(p?.source).toBe(source);
  });

  test("config default, then the only profile, then none", () => {
    expect(resolveProfile({ env: {}, config, state: emptyState() })?.source).toBe("config");
    const single: ConfigV1 = { version: 1, profiles: { solo: {} } };
    expect(resolveProfile({ env: {}, config: single, state: emptyState() })).toMatchObject({
      name: "solo",
      source: "only",
    });
    expect(
      resolveProfile({ env: {}, config: { version: 1, profiles: { a: {}, b: {} } }, state: emptyState() }),
    ).toBeNull();
  });

  test("OPENROUTER_API_KEY is ignored", () => {
    expect(
      resolveProfile({
        env: { OPENROUTER_API_KEY: FAKE_MGMT_KEY },
        config: { version: 1, profiles: {} },
        state: emptyState(),
      }),
    ).toBeNull();
  });

  test("ephemeral profile refs point at the environment, never at values", () => {
    const p = resolveProfile({ env: { ORCTL_MANAGEMENT_KEY: FAKE_MGMT_KEY }, config, state: emptyState() });
    expect(p?.managementRef).toBe("env:ORCTL_MANAGEMENT_KEY");
    expect(JSON.stringify(p)).not.toContain(FAKE_MGMT_KEY);
  });

  test("unknown explicit profile is NO_CREDENTIAL naming the available ones", () => {
    expect(() => resolveProfile({ flag: "nope", env: {}, config, state: emptyState() })).toThrow(
      /does not exist/,
    );
  });
});

describe("config and state files (plan §6.2, §6.3, §6.11)", () => {
  test("writes are atomic, 0600, refs only; unknown fields survive", async () => {
    const home = tempHome();
    homes.push(home);
    const store = new ProfileStore(home.env.ORCTL_CONFIG, join(home.dir, "state.json"));
    await store.saveConfig({ ...config, extra: { keep: true } } as ConfigV1);
    expect(statSync(home.env.ORCTL_CONFIG).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(home.env.ORCTL_CONFIG)).mode & 0o777).toBe(0o700);
    const reread = new ProfileStore(home.env.ORCTL_CONFIG, join(home.dir, "state.json"));
    const loaded = await reread.loadConfig();
    expect(loaded.config.profiles.acme?.color).toBe("red");
    expect((loaded.config as Record<string, unknown>).extra).toEqual({ keep: true });
    expect(loaded.warnings.some((w) => w.includes("extra"))).toBe(true);
  });

  test("a config holding a raw key is refused (S11)", async () => {
    const home = tempHome();
    homes.push(home);
    mkdirSync(dirname(home.env.ORCTL_CONFIG), { recursive: true });
    writeFileSync(home.env.ORCTL_CONFIG, `version = 1\n[profiles.p]\nmanagement_key = "${FAKE_MGMT_KEY}"\n`);
    await expect(new ProfileStore(home.env.ORCTL_CONFIG, "/dev/null").loadConfig()).rejects.toThrow(
      /raw API key/,
    );
  });

  test("a symlinked (Nix-managed) config is never written; the TOML to add is returned", async () => {
    const home = tempHome();
    homes.push(home);
    const target = join(home.dir, "store-config.toml");
    writeFileSync(target, 'version = 1\n[profiles.base]\ncolor = "blue"\n');
    mkdirSync(dirname(home.env.ORCTL_CONFIG), { recursive: true });
    symlinkSync(target, home.env.ORCTL_CONFIG);
    const store = new ProfileStore(home.env.ORCTL_CONFIG, join(home.dir, "state.json"));
    const cfg = structuredClone((await store.loadConfig()).config);
    cfg.profiles.newp = { management_key: "keychain:orctl/newp/management" };
    const err = await store.saveConfig(cfg, "newp").catch((e) => e);
    expect(err.code).toBe("USAGE");
    expect(err.hint).toContain("[profiles.newp]");
    expect(err.hint).toContain('management_key = "keychain:orctl/newp/management"');
    // state still writes
    await store.updateState((s) => {
      s.current_profile = "base";
    });
    expect((await store.loadState()).current_profile).toBe("base");
  });

  test("invalid config reports the field", async () => {
    const home = tempHome();
    homes.push(home);
    mkdirSync(dirname(home.env.ORCTL_CONFIG), { recursive: true });
    writeFileSync(home.env.ORCTL_CONFIG, 'version = 1\ndefault_profile = "ghost"\n');
    await expect(new ProfileStore(home.env.ORCTL_CONFIG, "/dev/null").loadConfig()).rejects.toThrow(
      /default_profile/,
    );
  });
});
