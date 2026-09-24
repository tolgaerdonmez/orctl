#!/usr/bin/env bun
/**
 * Entry point (plan §4.5): `orctl <command>` runs the CLI and never loads the TUI; bare `orctl`
 * on a terminal opens the TUI through a lazy import. Only commander and core are imported here.
 */
import { type CliDeps, processDeps } from "./cli/io.ts";
import { runCli } from "./cli/program.ts";
import { interruptGuarded, requestInterrupt } from "./core/interrupt.ts";
import { redact } from "./core/redact.ts";

function installCrashGuards(): void {
  const report = (err: unknown) => {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    process.stderr.write(`✖ orctl crashed: ${redact(text)}\n`);
    process.exit(9);
  };
  process.on("uncaughtException", report);
  process.on("unhandledRejection", report);
}

async function main(argv: string[]): Promise<number> {
  installCrashGuards();
  const base = processDeps();
  const deps: CliDeps = {
    ...base,
    launchTui: async (opts) => {
      if (!(base.stdinIsTTY && base.stdoutIsTTY)) {
        base.stderr("✖ The TUI needs an interactive terminal; use the CLI commands instead.\n");
        return 2;
      }
      const tui = await import("./tui/main.tsx");
      return tui.launchTui(opts, base);
    },
  };
  if (argv.length === 0) {
    if (deps.stdinIsTTY && deps.stdoutIsTTY && deps.launchTui) return deps.launchTui({});
    const code = await runCli(["--help"], { ...deps, stdout: deps.stderr });
    return code === 0 ? 2 : code;
  }
  return runCli(argv, deps);
}

process.on("SIGINT", () => {
  // During a rotation, stop at the next step boundary so the journal stays consistent (plan §8.1).
  if (interruptGuarded()) {
    requestInterrupt();
    process.stderr.write("\n! Stopping after the current step…\n");
    return;
  }
  process.stderr.write("\n✖ Interrupted.\n");
  process.exit(130);
});

const code = await main(process.argv.slice(2));
process.exit(code);
