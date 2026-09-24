import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Atomic private writes: temp file (0600) in the same directory, then rename (plan §6.2). */
export async function atomicWrite(path: string, content: string): Promise<void> {
  await ensurePrivateDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(tmp, content, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Octal permission bits of a file, or null when it does not exist. */
export async function fileMode(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mode & 0o777;
  } catch {
    return null;
  }
}

export function formatMode(mode: number): string {
  return mode.toString(8).padStart(4, "0");
}

export interface WritableCheck {
  writable: boolean;
  reason?: "nix" | "symlink" | undefined;
  target?: string | undefined;
}

/**
 * A config file managed declaratively (home-manager) is a symlink into the read-only Nix store;
 * orctl then prints the TOML to add instead of writing (plan §6.11).
 */
export async function checkWritable(path: string): Promise<WritableCheck> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch {
    return { writable: true };
  }
  if (!info.isSymbolicLink()) return { writable: true };
  const target = await realpath(path).catch(() => "");
  if (target.startsWith("/nix/store/")) return { writable: false, reason: "nix", target };
  return { writable: false, reason: "symlink", target };
}
