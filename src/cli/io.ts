import type { RuntimeDeps } from "../core/context.ts";
import type { Prompter } from "./prompts.ts";

/** Terminal I/O for one CLI run; tests capture it in memory. */
export interface CliDeps extends RuntimeDeps {
  stdout(text: string): void;
  stderr(text: string): void;
  readStdin(): Promise<string>;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  /** Terminal width when stdout is a TTY. */
  columns?: number | undefined;
  prompter?: Prompter | undefined;
  /** Launches the TUI (lazy import; absent until the TUI is available). */
  launchTui?:
    | ((opts: {
        screen?: string | undefined;
        profile?: string | undefined;
        config?: string | undefined;
        debug?: boolean;
      }) => Promise<number>)
    | undefined;
}

export interface GlobalOptions {
  profile?: string | undefined;
  json?: boolean | undefined;
  csv?: boolean | undefined;
  columns?: string | undefined;
  color?: boolean | undefined;
  quiet?: boolean | undefined;
  debug?: boolean | undefined;
  timeout?: string | undefined;
  yes?: boolean | undefined;
  config?: string | undefined;
  refresh?: boolean | undefined;
  offline?: boolean | undefined;
}

export function colorEnabled(globals: GlobalOptions, deps: CliDeps): boolean {
  if (globals.color === false) return false;
  if (deps.env.NO_COLOR !== undefined && deps.env.NO_COLOR !== "") return false;
  if (deps.env.FORCE_COLOR && deps.env.FORCE_COLOR !== "0") return true;
  return deps.stdoutIsTTY;
}

export function processDeps(): CliDeps {
  return {
    env: process.env,
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    readStdin: () => Bun.stdin.text(),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    columns: process.stdout.columns,
  };
}
