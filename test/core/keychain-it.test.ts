import { describe, expect, test } from "bun:test";
import { Secret } from "../../src/core/secret.ts";
import { createKeychainBackend } from "../../src/core/secrets/keychain-macos.ts";
import { bunProcessRunner } from "../../src/core/secrets/process.ts";
import { parseSecretRef } from "../../src/core/secrets/ref.ts";

/**
 * Real macOS Keychain round trip (plan §10). Opt-in only: it writes and then deletes a random
 * `orctl-test-*` item in the login keychain. Run with ORCTL_IT_KEYCHAIN=1 on macOS.
 */
const enabled = process.env.ORCTL_IT_KEYCHAIN === "1" && process.platform === "darwin";

describe.skipIf(!enabled)("macOS Keychain integration", () => {
  test("write via security -i, read back, delete", async () => {
    const service = `orctl-test-${Math.random().toString(36).slice(2, 10)}`;
    const ref = parseSecretRef(`keychain:${service}/it/management`);
    const kc = createKeychainBackend(bunProcessRunner, process.platform);
    const value = `sk-or-v1-FAKEIT${"0123456789abcdef".repeat(4)}`;
    try {
      await kc.write?.(ref, new Secret(value), "orctl integration test");
      expect((await kc.read(ref)).reveal()).toBe(value);
      // -U updates in place
      const updated = `${value.slice(0, -4)}ffff`;
      await kc.write?.(ref, new Secret(updated), "orctl integration test");
      expect((await kc.read(ref)).reveal()).toBe(updated);
    } finally {
      expect(await kc.delete?.(ref)).toBe(true);
    }
    await expect(kc.read(ref)).rejects.toMatchObject({ code: "NO_CREDENTIAL" });
  });
});
