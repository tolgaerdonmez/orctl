import type { KeyEvent } from "@opentui/core";

/**
 * The central key table (plan §5.6): the Help screen and the footer are generated from it, and
 * screens match keys through `keyId`, so a binding exists in exactly one place.
 */
export interface Binding {
  key: string;
  label: string;
  /** "global" or a screen id. */
  scope: string;
}

/** Canonical key string: "ctrl+p", "D", "d", "enter", "escape", "up", "1", "?", "space". */
export function keyId(key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "sequence">): string {
  const name = key.name === "return" ? "enter" : key.name;
  if (key.ctrl) return `ctrl+${name}`;
  if (key.meta) return `meta+${name}`;
  const seq = key.sequence;
  if (seq && seq.length === 1 && seq >= "!" && seq <= "~") return seq;
  if (name === "space" || seq === " ") return "space";
  if (name && name.length === 1 && key.shift) return name.toUpperCase();
  return name;
}

/** True for keys that type a character into a text field. */
export function isPrintable(key: Pick<KeyEvent, "ctrl" | "meta" | "sequence">): boolean {
  return (
    !key.ctrl && !key.meta && key.sequence.length === 1 && key.sequence >= " " && key.sequence !== "\u007f"
  );
}

export const GLOBAL_BINDINGS: Binding[] = [
  { key: "1-7", label: "switch screen", scope: "global" },
  { key: "ctrl+o", label: "switch profile", scope: "global" },
  { key: "ctrl+p", label: "command palette", scope: "global" },
  { key: "?", label: "help", scope: "global" },
  { key: "r", label: "refresh", scope: "global" },
  { key: "/", label: "filter", scope: "global" },
  { key: "y", label: "copy CLI equivalent", scope: "global" },
  { key: "escape", label: "back / close", scope: "global" },
  { key: "q", label: "quit", scope: "global" },
];

export const SCREEN_BINDINGS: Binding[] = [
  { key: "enter", label: "use profile", scope: "profiles" },
  { key: "a", label: "add profile", scope: "profiles" },
  { key: "e", label: "edit profile", scope: "profiles" },
  { key: "R", label: "rename profile", scope: "profiles" },
  { key: "D", label: "remove profile", scope: "profiles" },
  { key: "v", label: "verify profiles", scope: "profiles" },
  { key: "w", label: "refresh whoami", scope: "dashboard" },
  { key: "/", label: "search", scope: "models" },
  { key: "f", label: "filters", scope: "models" },
  { key: "s", label: "cycle sort", scope: "models" },
  { key: "x", label: "clear filters", scope: "models" },
  { key: "enter", label: "model details", scope: "models" },
  { key: "tab ←→", label: "detail tabs", scope: "models" },
  { key: "/", label: "search", scope: "providers" },
  { key: "tab", label: "cycle workspace", scope: "keys" },
  { key: "x", label: "show/hide disabled", scope: "keys" },
  { key: "/", label: "filter", scope: "keys" },
  { key: "enter", label: "key details", scope: "keys" },
  { key: "n", label: "new key", scope: "keys" },
  { key: "e", label: "edit key", scope: "keys" },
  { key: "space", label: "enable / disable", scope: "keys" },
  { key: "D", label: "delete key", scope: "keys" },
  { key: "r", label: "rotate key", scope: "keys" },
];

export function bindingsFor(scope: string): Binding[] {
  return SCREEN_BINDINGS.filter((b) => b.scope === scope);
}
