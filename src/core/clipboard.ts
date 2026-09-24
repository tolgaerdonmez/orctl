import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { OrctlError } from "./errors.ts";
import type { ProcessRunner } from "./secrets/process.ts";

/**
 * Clipboard delivery for keys (plan §9 S7). The value goes to pbcopy over stdin, never argv.
 * After 45 s the clipboard is cleared if it still holds the same value; clipboard history
 * managers (Raycast, Maccy, …) remain an exposure, which callers warn about.
 */
export interface Clipboard {
  copy(value: string): Promise<void>;
  read(): Promise<string | null>;
  clear(): Promise<void>;
  /** Clears the clipboard after `ms` if it still holds `value`; survives the CLI process exiting. */
  clearLater(value: string, ms?: number): void;
}

export const CLIPBOARD_CLEAR_MS = 45_000;

interface Tools {
  copy: string[];
  paste: string[];
  hash: string;
}

export function createSystemClipboard(
  run: ProcessRunner,
  platform: string,
  which: (b: string) => string | null,
): Clipboard {
  const tools = (): Tools | null => {
    if (platform === "darwin") {
      return { copy: ["/usr/bin/pbcopy"], paste: ["/usr/bin/pbpaste"], hash: "/usr/bin/shasum -a 256" };
    }
    const sha = which("sha256sum") ? "sha256sum" : "shasum -a 256";
    const wlCopy = which("wl-copy");
    if (wlCopy)
      return { copy: [wlCopy], paste: [which("wl-paste") ?? "wl-paste", "--no-newline"], hash: sha };
    const xclip = which("xclip");
    if (xclip) {
      return {
        copy: [xclip, "-selection", "clipboard"],
        paste: [xclip, "-selection", "clipboard", "-o"],
        hash: sha,
      };
    }
    return null;
  };
  const need = () => {
    const t = tools();
    if (!t) {
      throw new OrctlError("USAGE", "No clipboard tool found (pbcopy, wl-copy or xclip).", {
        hint: "Use --show or --store instead.",
      });
    }
    return t;
  };
  return {
    async copy(value) {
      const res = await run(need().copy, { stdin: value, timeoutMs: 10_000 });
      if (res.code !== 0) throw new OrctlError("UNEXPECTED", "Copying to the clipboard failed.");
    },
    async read() {
      const t = tools();
      if (!t) return null;
      const res = await run(t.paste, { timeoutMs: 10_000 });
      return res.code === 0 ? res.stdout : null;
    },
    async clear() {
      const t = tools();
      if (t) await run(t.copy, { stdin: "", timeoutMs: 10_000 });
    },
    clearLater(value, ms = CLIPBOARD_CLEAR_MS) {
      const t = tools();
      if (!t) return;
      // Only the SHA-256 of the value is passed to the detached shell, never the value itself.
      const digest = createHash("sha256").update(value).digest("hex");
      const q = (a: string[]) => a.map((x) => `'${x.replace(/'/g, "'\\''")}'`).join(" ");
      const script = `sleep ${Math.ceil(ms / 1000)}; cur=$(${q(t.paste)} | ${t.hash} | cut -d' ' -f1); [ "$cur" = "$1" ] && printf '' | ${q(t.copy)}`;
      try {
        const child = spawn("/bin/sh", ["-c", script, "orctl-clipboard", digest], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      } catch {
        // best effort
      }
    },
  };
}
