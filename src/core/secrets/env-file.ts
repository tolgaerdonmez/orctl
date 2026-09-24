import { readFile, stat } from "node:fs/promises";
import { OrctlError } from "../errors.ts";
import { type Env, expandHome } from "../paths.ts";
import { Secret } from "../secret.ts";
import type { SecretRef } from "./ref.ts";
import type { SecretBackend } from "./store.ts";

/** `env:<VAR>` references; meant for CI and one-off use (plan §6.4). */
export function createEnvBackend(env: Env): SecretBackend {
  return {
    scheme: "env",
    writable: false,
    async read(ref) {
      const { name } = ref as Extract<SecretRef, { scheme: "env" }>;
      const value = env[name];
      if (!value) {
        throw new OrctlError("NO_CREDENTIAL", `Environment variable ${name} (from ${ref.raw}) is not set.`);
      }
      return new Secret(value.trim());
    },
  };
}

/** `file:<path>` references; the file must not be readable by group or others (plan §6.4). */
export function createFileBackend(home: string): SecretBackend {
  return {
    scheme: "file",
    writable: false,
    async read(ref) {
      const path = expandHome((ref as Extract<SecretRef, { scheme: "file" }>).path, home);
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        info = await stat(path);
      } catch {
        throw new OrctlError("NO_CREDENTIAL", `Secret file ${path} (from ${ref.raw}) does not exist.`);
      }
      if ((Number(info.mode) & 0o077) !== 0) {
        const mode = (Number(info.mode) & 0o777).toString(8).padStart(4, "0");
        throw new OrctlError(
          "NO_CREDENTIAL",
          `Secret file ${path} has permissions ${mode}; 0600 is required.`,
          {
            hint: `chmod 600 ${path}`,
          },
        );
      }
      const value = (await readFile(path, "utf8")).replace(/\r?\n$/, "");
      if (!value) throw new OrctlError("NO_CREDENTIAL", `Secret file ${path} is empty.`);
      return new Secret(value);
    },
  };
}
