import { OrctlError } from "../errors.ts";
import { redact } from "../redact.ts";
import { KEY_SHAPE, Secret } from "../secret.ts";
import type { ProcessRunner } from "./process.ts";
import { KEYCHAIN_SAFE, type SecretRef } from "./ref.ts";
import type { SecretBackend } from "./store.ts";

/**
 * macOS Keychain through Apple's /usr/bin/security (plan §6.5, K10).
 *
 * Reads use `find-generic-password -w`, which prints the value on stdout. Writes never put the
 * secret in argv (`-w <secret>` shows up in `ps`); instead `security -i` reads the command from
 * stdin. Because the item is created by the fixed, Apple-signed `security` binary, rebuilding
 * orctl does not trigger new Keychain access prompts.
 */
export const SECURITY_BIN = "/usr/bin/security";
const ITEM_NOT_FOUND = 44;

type KeychainRef = Extract<SecretRef, { scheme: "keychain" }>;

function describe(stderr: string): string {
  return redact(stderr.replace(/security>\s*/g, "").trim()) || "no detail";
}

export function createKeychainBackend(run: ProcessRunner, platform: string): SecretBackend {
  const ensureMac = () => {
    if (platform !== "darwin") {
      throw new OrctlError("NO_CREDENTIAL", "The macOS Keychain is not available on this platform.", {
        hint: "Use an op://, env: or file: reference instead.",
      });
    }
  };

  return {
    scheme: "keychain",
    writable: true,

    async read(ref) {
      ensureMac();
      const { service, account } = ref as KeychainRef;
      const res = await run([SECURITY_BIN, "find-generic-password", "-s", service, "-a", account, "-w"], {
        timeoutMs: 60_000,
      });
      if (res.code === ITEM_NOT_FOUND) {
        throw new OrctlError("NO_CREDENTIAL", `Keychain item ${ref.raw} was not found.`, {
          hint: "Store the key again with `orctl profile set <name> --mgmt-key-stdin`.",
        });
      }
      if (res.code !== 0) {
        throw new OrctlError(
          "NO_CREDENTIAL",
          `Could not read ${ref.raw} from the Keychain: ${describe(res.stderr)}`,
        );
      }
      const value = res.stdout.replace(/\r?\n$/, "");
      if (!value) throw new OrctlError("NO_CREDENTIAL", `Keychain item ${ref.raw} is empty.`);
      return new Secret(value);
    },

    async write(ref, secret, label) {
      ensureMac();
      const { service, account } = ref as KeychainRef;
      const value = secret.reveal();
      if (!KEY_SHAPE.test(value)) {
        throw new OrctlError("USAGE", "Refusing to store a value that does not look like an OpenRouter key.");
      }
      if (!KEYCHAIN_SAFE.test(account) || !KEYCHAIN_SAFE.test(label) || !KEYCHAIN_SAFE.test(service)) {
        throw new OrctlError(
          "USAGE",
          "Keychain service, account and label may only contain [A-Za-z0-9 ._/-].",
        );
      }
      const command = `add-generic-password -U -s "${service}" -a "${account}" -l "${label}" -w ${value}\n`;
      const res = await run([SECURITY_BIN, "-i"], { stdin: command, timeoutMs: 60_000 });
      const detail = describe(res.stderr);
      if (res.code !== 0 || (detail !== "no detail" && /error|failed|could not/i.test(detail))) {
        throw new OrctlError("NO_CREDENTIAL", `Could not write ${ref.raw} to the Keychain: ${detail}`);
      }
      // `security -i` can exit 0 after a failed command, so confirm by reading the item back.
      const stored = await this.read(ref);
      if (!stored.equals(secret)) {
        throw new OrctlError("NO_CREDENTIAL", `Keychain write to ${ref.raw} could not be verified.`);
      }
    },

    async delete(ref) {
      ensureMac();
      const { service, account } = ref as KeychainRef;
      const res = await run([SECURITY_BIN, "delete-generic-password", "-s", service, "-a", account], {
        timeoutMs: 60_000,
      });
      if (res.code !== 0 && res.code !== ITEM_NOT_FOUND) {
        throw new OrctlError(
          "NO_CREDENTIAL",
          `Could not delete ${ref.raw} from the Keychain: ${describe(res.stderr)}`,
        );
      }
      return res.code === 0;
    },
  };
}
