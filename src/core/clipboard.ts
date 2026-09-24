import { OrctlError } from "./errors.ts";
import type { ProcessRunner } from "./secrets/process.ts";

/**
 * Clipboard delivery for keys (plan §9 S7). The value goes to pbcopy over stdin, never argv.
 * After 45 s the clipboard is cleared if it still holds the same value, so clipboard history
 * managers are the only remaining exposure, which callers warn about.
 */
export interface Clipboard {
  copy(value: string): Promise<void>;
  read(): Promise<string | null>;
  clear(): Promise<void>;
}

export const CLIPBOARD_CLEAR_MS = 45_000;

export function createSystemClipboard(
  run: ProcessRunner,
  platform: string,
  which: (b: string) => string | null,
): Clipboard {
  const tools = (): { copy: string[]; paste: string[] } | null => {
    if (platform === "darwin") return { copy: ["/usr/bin/pbcopy"], paste: ["/usr/bin/pbpaste"] };
    const wlCopy = which("wl-copy");
    if (wlCopy) return { copy: [wlCopy], paste: [which("wl-paste") ?? "wl-paste", "--no-newline"] };
    const xclip = which("xclip");
    if (xclip)
      return { copy: [xclip, "-selection", "clipboard"], paste: [xclip, "-selection", "clipboard", "-o"] };
    return null;
  };
  const need = () => {
    const t = tools();
    if (!t)
      throw new OrctlError("USAGE", "No clipboard tool found (pbcopy, wl-copy or xclip).", {
        hint: "Use --show or --store instead.",
      });
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
  };
}

/** Clears the clipboard later if it still holds `value`; returns a cancel function. */
export function scheduleClipboardClear(
  clipboard: Clipboard,
  value: string,
  ms = CLIPBOARD_CLEAR_MS,
): () => void {
  const timer = setTimeout(async () => {
    try {
      if ((await clipboard.read()) === value) await clipboard.clear();
    } catch {
      // best effort
    }
  }, ms);
  return () => clearTimeout(timer);
}
