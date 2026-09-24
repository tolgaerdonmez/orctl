import { OrctlError } from "../errors.ts";
import { redact } from "../redact.ts";
import { Secret } from "../secret.ts";
import type { ProcessRunner, WhichFn } from "./process.ts";
import type { SecretBackend } from "./store.ts";

/** 1Password CLI references, read-only in v1 (plan §6.4, K11). Biometric prompts are `op`'s own. */
export function createOnePasswordBackend(run: ProcessRunner, which: WhichFn): SecretBackend {
  return {
    scheme: "op",
    writable: false,
    async read(ref) {
      const bin = which("op");
      if (!bin) {
        throw new OrctlError("NO_CREDENTIAL", `The 1Password CLI (op) is needed to read ${ref.raw}.`, {
          hint: "Install the 1Password CLI and sign in, or use a keychain: reference.",
        });
      }
      const res = await run([bin, "read", "--no-newline", ref.raw], { timeoutMs: 120_000 });
      if (res.code !== 0) {
        throw new OrctlError(
          "NO_CREDENTIAL",
          `op could not read ${ref.raw}: ${redact(res.stderr.trim()) || "no detail"}`,
          {
            hint: "Check that `op` is signed in and the reference points at the right field.",
          },
        );
      }
      const value = res.stdout.replace(/\r?\n$/, "");
      if (!value) throw new OrctlError("NO_CREDENTIAL", `${ref.raw} resolved to an empty value.`);
      return new Secret(value);
    },
  };
}
