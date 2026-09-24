import { Command, CommanderError, Option } from "commander";
import { OrctlError } from "../core/errors.ts";
import { KEY_SHAPE, Secret } from "../core/secret.ts";
import { ORCTL_VERSION } from "../core/version.ts";
import { attributeName, type CommandSpec, type FlagSpec, longFlag, SPECS } from "../surface/spec.ts";
import { completeInteractively } from "./interactive.ts";
import type { CliDeps, GlobalOptions } from "./io.ts";
import { runOp } from "./run-op.ts";

export const GLOBAL_FLAGS = [
  "--profile",
  "--json",
  "--csv",
  "--columns",
  "--no-color",
  "--quiet",
  "--debug",
  "--timeout",
  "--yes",
  "--config",
  "--refresh",
  "--offline",
] as const;

export type ActionHook = (
  spec: CommandSpec,
  input: Record<string, unknown>,
  globals: GlobalOptions,
) => Promise<number>;

function addGlobalOptions(program: Command): void {
  program
    .option("-p, --profile <name>", "profile to use (overrides ORCTL_PROFILE and the active profile)")
    .option("--json", "machine-readable output (stable envelope)")
    .option("--csv", "CSV output for list commands")
    .option("--columns <list>", "columns to show; +col adds optional columns")
    .option("--no-color", "disable colors (NO_COLOR is honored too)")
    .option("-q, --quiet", "suppress banners and warnings")
    .option("--debug", "print redacted SDK request/response logs to stderr")
    .option("--timeout <seconds>", "request timeout in seconds (default 20)")
    .option("-y, --yes", "confirm destructive actions without asking")
    .option("--config <path>", "config file (default ~/.config/orctl/config.toml)")
    .option("--refresh", "bypass the public data cache and refetch")
    .option("--offline", "use cached public data only");
}

/** Reads a secret from stdin once per invocation (plan §6.4: secrets never go through argv). */
async function readStdinSecret(deps: CliDeps, flag: string): Promise<Secret> {
  if (deps.stdinIsTTY) {
    throw new OrctlError("USAGE", `${flag} expects the key on stdin, e.g. \`op read … | orctl … ${flag}\`.`);
  }
  const value = (await deps.readStdin()).replace(/\r?\n$/, "").trim();
  if (!value) throw new OrctlError("USAGE", `${flag}: stdin was empty.`);
  if (!KEY_SHAPE.test(value))
    throw new OrctlError("USAGE", `${flag}: stdin does not look like an OpenRouter key.`);
  return new Secret(value);
}

function parseFlagValue(flag: FlagSpec, raw: unknown): unknown {
  if (flag.parse && typeof raw === "string") {
    try {
      return flag.parse(raw);
    } catch (err) {
      throw new OrctlError("USAGE", `${longFlag(flag.flags)}: ${(err as Error).message}`);
    }
  }
  if (flag.type === "number" && typeof raw === "string") {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n))
      throw new OrctlError("USAGE", `${longFlag(flag.flags)} expects a number, got "${raw}".`);
    return n;
  }
  return raw;
}

/** Converts parsed commander values into the operation's input object using the spec mapping. */
async function buildInput(
  spec: CommandSpec,
  args: unknown[],
  cmd: Command,
  deps: CliDeps,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  spec.positionals.forEach((pos, i) => {
    const v = args[i];
    if (v !== undefined) input[pos.field] = v;
  });
  const local = cmd.opts() as Record<string, unknown>;
  const global = rootOf(cmd).opts() as Record<string, unknown>;
  const stdinFlags = spec.flags.filter(
    (f) => f.type === "stdin-secret" && local[attributeName(f.flags)] === true,
  );
  if (stdinFlags.length > 1) {
    throw new OrctlError(
      "USAGE",
      `Only one --…-stdin flag can be used per command (${stdinFlags.map((f) => longFlag(f.flags)).join(", ")}).`,
    );
  }
  for (const flag of spec.flags) {
    const attr = attributeName(flag.flags);
    const isGlobal = (GLOBAL_FLAGS as readonly string[]).includes(longFlag(flag.flags));
    const value = isGlobal ? global[attr] : local[attr];
    if (value === undefined) continue;
    if (!isGlobal) {
      const source = cmd.getOptionValueSource(attr);
      if (source !== "cli" && source !== "env") continue;
    }
    switch (flag.type) {
      case "stdin-secret":
        if (value === true) input[flag.field] = await readStdinSecret(deps, longFlag(flag.flags));
        break;
      case "negatable":
        if (value === false) input[flag.field] = false;
        break;
      case "boolean":
        if (value === true) input[flag.field] = true;
        break;
      default:
        input[flag.field] = parseFlagValue(flag, value);
    }
  }
  return input;
}

function rootOf(cmd: Command): Command {
  let cur = cmd;
  while (cur.parent) cur = cur.parent;
  return cur;
}

function commandPath(root: Command, path: readonly string[]): Command {
  let cur = root;
  for (const name of path) {
    const existing = cur.commands.find((c) => c.name() === name);
    if (existing) {
      cur = existing;
      continue;
    }
    const next = new Command(name);
    cur.addCommand(next);
    cur = next;
  }
  return cur;
}

function registerSpec(
  program: Command,
  spec: CommandSpec,
  path: readonly string[],
  deps: CliDeps,
  hook: ActionHook,
  setExit: (code: number) => void,
  aliases: string[],
): void {
  const parent = commandPath(program, path.slice(0, -1));
  const name = path[path.length - 1] as string;
  const cmd = new Command(name).description(spec.description).aliases(aliases);
  for (const pos of spec.positionals)
    cmd.argument(pos.required ? `<${pos.name}>` : `[${pos.name}]`, pos.description);
  for (const flag of spec.flags) {
    if ((GLOBAL_FLAGS as readonly string[]).includes(longFlag(flag.flags))) continue;
    const option = new Option(flag.flags, flag.description);
    if (flag.choices) option.choices(flag.choices as string[]);
    cmd.addOption(option);
  }
  if (spec.examples?.length)
    cmd.addHelpText("after", `\nExamples:\n${spec.examples.map((e) => `  $ ${e}`).join("\n")}`);
  cmd.action(async (...actionArgs: unknown[]) => {
    const command = actionArgs[actionArgs.length - 1] as Command;
    const args = actionArgs.slice(0, spec.positionals.length);
    const globals = rootOf(command).opts() as GlobalOptions;
    const input = await buildInput(spec, args, command, deps);
    setExit(await hook(spec, input, globals));
  });
  parent.addCommand(cmd);
}

export function buildProgram(deps: CliDeps, setExit: (code: number) => void, hook?: ActionHook): Command {
  const program = new Command("orctl")
    .description("OpenRouter account management: profiles, keys, models, usage, workspaces.")
    .version(ORCTL_VERSION, "-V, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .showSuggestionAfterError(true)
    .configureHelp({ showGlobalOptions: true, sortSubcommands: false })
    .exitOverride()
    .configureOutput({ writeOut: (s) => deps.stdout(s), writeErr: (s) => deps.stderr(s) });
  addGlobalOptions(program);

  const action: ActionHook =
    hook ??
    (async (spec, input, globals) => {
      const completed = await completeInteractively(spec, input, globals, deps);
      return runOp(spec, completed, globals, deps);
    });

  const groups: Record<string, string> = {
    profile: "Manage profiles (one per OpenRouter account)",
    auth: "Identity and diagnostics",
    models: "Browse models and prices (no key needed)",
    providers: "Inference providers (no key needed)",
    keys: "Manage API keys (management key)",
    usage: "Spending breakdown (management key)",
  };
  for (const spec of SPECS) {
    const sameParent = (p: readonly string[]) =>
      p.length === spec.path.length && p.slice(0, -1).join(" ") === spec.path.slice(0, -1).join(" ");
    const aliases = spec.aliases ?? [];
    registerSpec(
      program,
      spec,
      spec.path,
      deps,
      action,
      setExit,
      aliases.filter(sameParent).map((a) => a[a.length - 1] as string),
    );
    for (const path of aliases.filter((a) => !sameParent(a)))
      registerSpec(program, spec, path, deps, action, setExit, []);
  }
  for (const cmd of program.commands) {
    const description = groups[cmd.name()];
    if (description && !cmd.description()) cmd.description(description);
  }

  program
    .command("tui")
    .description("Open the interactive terminal UI")
    .argument("[screen]", "keys | models | providers | usage | workspaces | profiles")
    .action(async (screen: string | undefined, _opts: unknown, command: Command) => {
      const globals = rootOf(command).opts() as GlobalOptions;
      if (!deps.launchTui) {
        deps.stderr("✖ The TUI is not available in this build.\n");
        setExit(2);
        return;
      }
      setExit(
        await deps.launchTui({
          screen,
          profile: globals.profile,
          config: globals.config,
          debug: Boolean(globals.debug),
        }),
      );
    });
  // Commands created with `new Command()` do not inherit settings; copy them down the tree so no
  // subcommand ever calls process.exit or writes to the real stdout in tests.
  const inherit = (cmd: Command) => {
    for (const sub of cmd.commands) {
      sub.copyInheritedSettings(cmd);
      inherit(sub);
    }
  };
  inherit(program);
  return program;
}

/** Runs the CLI for argv (without the executable), returning the exit code. */
export async function runCli(argv: string[], deps: CliDeps, hook?: ActionHook): Promise<number> {
  let exitCode = 0;
  const program = buildProgram(
    deps,
    (code) => {
      exitCode = code;
    },
    hook,
  );
  try {
    await program.parseAsync(argv, { from: "user" });
    return exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (
        err.code === "commander.helpDisplayed" ||
        err.code === "commander.version" ||
        err.code === "commander.help"
      )
        return 0;
      return 2;
    }
    if (err instanceof OrctlError) {
      deps.stderr(`✖ ${err.message}\n${err.hint ? `  ${err.hint}\n` : ""}`);
      return err.exit;
    }
    throw err;
  }
}
