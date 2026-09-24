import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * XDG-style locations (plan §6.2). macOS also uses ~/.config and ~/.local/state, following the
 * usual CLI convention rather than ~/Library.
 */
export interface Paths {
  configFile: string;
  stateDir: string;
  stateFile: string;
  rotationsDir: string;
  cacheDir: string;
}

export type Env = Record<string, string | undefined>;

export function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

export function resolvePaths(env: Env, opts: { configFlag?: string | undefined; home?: string } = {}): Paths {
  const home = opts.home ?? env.HOME ?? homedir();
  const configFile = opts.configFlag
    ? resolve(expandHome(opts.configFlag, home))
    : env.ORCTL_CONFIG
      ? resolve(expandHome(env.ORCTL_CONFIG, home))
      : join(env.XDG_CONFIG_HOME || join(home, ".config"), "orctl", "config.toml");
  const stateDir = join(env.XDG_STATE_HOME || join(home, ".local", "state"), "orctl");
  const cacheDir = join(env.XDG_CACHE_HOME || join(home, ".cache"), "orctl", "v1");
  return {
    configFile,
    stateDir,
    stateFile: join(stateDir, "state.json"),
    rotationsDir: join(stateDir, "rotations"),
    cacheDir,
  };
}
