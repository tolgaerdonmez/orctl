import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CliDeps } from "../src/cli/io.ts";
import { runCli } from "../src/cli/program.ts";
import type { Prompter } from "../src/cli/prompts.ts";
import { createContext, type RunOptions } from "../src/core/context.ts";
import type { Ctx } from "../src/core/ops/types.ts";
import type { Clock } from "../src/core/runtime.ts";
import { createEnvBackend, createFileBackend } from "../src/core/secrets/env-file.ts";
import type { SecretBackend } from "../src/core/secrets/store.ts";
import { FakeFetcher } from "./fakes/fetcher.ts";
import { FakeKeychain, FakeOnePassword } from "./fakes/secret-store.ts";

const ROOT = resolve(import.meta.dir, "..");

/** Temp dirs live inside the repo's gitignored .tmp/, never in the user's real config. */
export interface TempEnv extends Record<string, string> {
  HOME: string;
  ORCTL_CONFIG: string;
  XDG_STATE_HOME: string;
  XDG_CACHE_HOME: string;
}

export function tempHome(): { dir: string; env: TempEnv; cleanup(): void } {
  const dir = join(ROOT, ".tmp", `t-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  const env = {
    HOME: dir,
    ORCTL_CONFIG: join(dir, "config", "orctl", "config.toml"),
    XDG_STATE_HOME: join(dir, "state"),
    XDG_CACHE_HOME: join(dir, "cache"),
    NO_COLOR: "1",
  };
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const fixedClock = (
  iso = "2026-09-24T12:00:00Z",
): Clock & { set(iso: string): void; advance(ms: number): void } => {
  let now = new Date(iso);
  return {
    now: () => new Date(now),
    set: (v: string) => {
      now = new Date(v);
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
};

export interface Harness {
  env: TempEnv;
  dir: string;
  fetcher: FakeFetcher;
  keychain: FakeKeychain;
  op: FakeOnePassword;
  clock: ReturnType<typeof fixedClock>;
  backends(): SecretBackend[];
  deps(over?: Partial<CliDeps> & { stdin?: string }): CliDeps & { out: string[]; err: string[] };
  cli(
    argv: string[],
    over?: Partial<CliDeps> & { stdin?: string },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  ctx(options?: RunOptions): Promise<Ctx>;
  cleanup(): void;
}

export function harness(opts: { env?: Record<string, string> } = {}): Harness {
  const home = tempHome();
  const env: TempEnv = { ...home.env, ...opts.env };
  const fetcher = new FakeFetcher();
  const keychain = new FakeKeychain();
  const op = new FakeOnePassword();
  const clock = fixedClock();
  const backends = () => [keychain, op, createEnvBackend(env), createFileBackend(home.dir)];
  const makeDeps = (over: Partial<CliDeps> & { stdin?: string } = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const deps: CliDeps & { out: string[]; err: string[] } = {
      env,
      home: home.dir,
      platform: "darwin",
      fetcher: fetcher.fetcher,
      retryConfig: { strategy: "none" },
      clock,
      secretBackends: backends(),
      clipboard: { copy: async () => {}, read: async () => null, clear: async () => {} },
      debugSink: (line) => err.push(`${line}\n`),
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      readStdin: async () => over.stdin ?? "",
      stdinIsTTY: false,
      stdoutIsTTY: false,
      columns: 120,
      out,
      err,
      ...over,
    };
    return deps;
  };
  return {
    env,
    dir: home.dir,
    fetcher,
    keychain,
    op,
    clock,
    backends,
    deps: makeDeps,
    async cli(argv, over) {
      const deps = makeDeps(over);
      const code = await runCli(argv, deps);
      return { code, stdout: deps.out.join(""), stderr: deps.err.join("") };
    },
    ctx: (options) => createContext(makeDeps(), options),
    cleanup: home.cleanup,
  };
}

/** A Prompter that answers from a script, in order; unexpected prompts fail the test. */
export function scriptedPrompter(answers: Array<string | boolean>): Prompter & { asked: string[] } {
  const asked: string[] = [];
  const next = (message: string) => {
    asked.push(message);
    if (answers.length === 0) throw new Error(`unexpected prompt: ${message}`);
    return answers.shift() as never;
  };
  return {
    asked,
    text: async (m) => next(m),
    password: async (m) => next(m),
    select: async (m) => next(m),
    confirm: async (m) => next(m),
    note: () => {},
    spinner: () => ({ start: () => {}, stop: () => {} }),
  };
}
