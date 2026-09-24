#!/usr/bin/env bun
/**
 * Entry point (plan §4.5): `orctl <command>` runs the CLI and never loads the TUI; bare `orctl`
 * on a terminal opens the TUI through a lazy import. Only commander and core are imported here.
 */
import { processDeps } from "./cli/io.ts";
import { runCli } from "./cli/program.ts";
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
  const deps = processDeps();
  if (argv.length === 0) {
    if (deps.stdinIsTTY && deps.stdoutIsTTY && deps.launchTui) return deps.launchTui({});
    const code = await runCli(["--help"], { ...deps, stdout: deps.stderr });
    return code === 0 ? 2 : code;
  }
  return runCli(argv, deps);
}

process.on("SIGINT", () => {
  process.stderr.write("\n✖ Interrupted.\n");
  process.exit(130);
});

const code = await main(process.argv.slice(2));
process.exit(code);
