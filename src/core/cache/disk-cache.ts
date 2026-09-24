import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mapError } from "../client/map-error.ts";
import { OrctlError } from "../errors.ts";
import { atomicWrite, ensurePrivateDir, readTextIfExists } from "../fs-util.ts";
import type { Clock } from "../runtime.ts";
import { SDK_VERSION } from "../version.ts";

/**
 * On-disk cache for public data only (plan §8.4, K19): the model list, providers and model
 * endpoints. Account data (keys, credits, usage, workspaces) is never written here.
 *
 * Envelope: {schema, sdk, fetched_at, data}. A schema or SDK-pin mismatch, or a corrupt file,
 * counts as a miss. Writes are atomic.
 */
export const CACHE_SCHEMA = 1;

export const TTL = {
  models: 10 * 60_000,
  providers: 24 * 60 * 60_000,
  endpoints: 5 * 60_000,
  queries: 10 * 60_000,
} as const;

export type CachePolicy = "default" | "refresh" | "offline";

interface Envelope<T> {
  schema: number;
  sdk: string;
  fetched_at: string;
  data: T;
}

export interface CacheResult<T> {
  data: T;
  fetchedAt: Date;
  /** Served from disk rather than fetched in this run. */
  cached: boolean;
  /** Served past its TTL because the network failed. */
  stale: boolean;
}

export class DiskCache {
  constructor(
    readonly dir: string,
    private readonly clock: Clock,
  ) {}

  path(key: string): string {
    const safe = key.replace(/[^A-Za-z0-9._/-]+/g, "_").replace(/\.\.+/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  async read<T>(key: string): Promise<{ data: T; fetchedAt: Date } | null> {
    try {
      const text = await readTextIfExists(this.path(key));
      if (text === null) return null;
      const env = JSON.parse(text) as Envelope<T>;
      if (env.schema !== CACHE_SCHEMA || env.sdk !== SDK_VERSION || !env.fetched_at) return null;
      const fetchedAt = new Date(env.fetched_at);
      if (Number.isNaN(fetchedAt.getTime())) return null;
      return { data: env.data, fetchedAt };
    } catch {
      return null;
    }
  }

  async write<T>(key: string, data: T): Promise<Date> {
    const fetchedAt = this.clock.now();
    const env: Envelope<T> = {
      schema: CACHE_SCHEMA,
      sdk: SDK_VERSION,
      fetched_at: fetchedAt.toISOString(),
      data,
    };
    await ensurePrivateDir(dirname(this.path(key)));
    await atomicWrite(this.path(key), JSON.stringify(env));
    return fetchedAt;
  }

  /**
   * Cache-aside read honoring --refresh / --offline. On a network failure an expired entry is
   * returned (marked stale) rather than failing, since public catalog data changes slowly.
   */
  async fetch<T>(
    key: string,
    ttlMs: number,
    policy: CachePolicy,
    load: () => Promise<T>,
  ): Promise<CacheResult<T>> {
    const hit = policy === "refresh" ? null : await this.read<T>(key);
    const now = this.clock.now().getTime();
    if (policy === "offline") {
      if (!hit) {
        throw new OrctlError("NETWORK", `No cached data for ${key} (--offline).`, {
          hint: "Run the command once without --offline to fill the cache.",
        });
      }
      return { ...hit, cached: true, stale: now - hit.fetchedAt.getTime() > ttlMs };
    }
    if (hit && now - hit.fetchedAt.getTime() <= ttlMs) return { ...hit, cached: true, stale: false };
    try {
      const data = await load();
      const fetchedAt = await this.write(key, data);
      return { data, fetchedAt, cached: false, stale: false };
    } catch (err) {
      const fallback = hit ?? (policy === "refresh" ? await this.read<T>(key) : null);
      if (fallback && mapError(err).code === "NETWORK") {
        return { ...fallback, cached: true, stale: true };
      }
      throw err;
    }
  }

  /** Total size and oldest entry, for doctor. */
  async stats(): Promise<{ files: number; bytes: number; oldest: Date | null }> {
    let files = 0;
    let bytes = 0;
    let oldest: Date | null = null;
    const walk = async (dir: string) => {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const p = join(dir, name);
        const s = await stat(p);
        if (s.isDirectory()) await walk(p);
        else {
          files++;
          bytes += s.size;
          if (!oldest || s.mtime < oldest) oldest = s.mtime;
        }
      }
    };
    await walk(this.dir);
    return { files, bytes, oldest };
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}
