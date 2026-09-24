import { homedir } from "node:os";
import type { Fetcher, OpenRouter } from "@openrouter/sdk";
import type { RetryConfig } from "@openrouter/sdk/lib/retries.js";
import { DiskCache } from "./cache/disk-cache.ts";
import { type ApiRole, createClient, type RateLimitInfo } from "./client/factory.ts";
import { type Clipboard, createSystemClipboard } from "./clipboard.ts";
import { OrctlError } from "./errors.ts";
import { createLogger, type LineSink } from "./logger.ts";
import { messages } from "./messages.ts";
import type { CachePolicy, Ctx, OpMeta, SdkProvider } from "./ops/types.ts";
import { emptyMeta } from "./ops/types.ts";
import { type Env, resolvePaths } from "./paths.ts";
import { ProfileStore } from "./profile/config-store.ts";
import { type ResolvedProfile, resolveProfile } from "./profile/resolve.ts";
import { type Clock, createLimiter, systemClock } from "./runtime.ts";
import type { Secret } from "./secret.ts";
import { createEnvBackend, createFileBackend } from "./secrets/env-file.ts";
import { createKeychainBackend } from "./secrets/keychain-macos.ts";
import { createOnePasswordBackend } from "./secrets/onepassword.ts";
import { bunProcessRunner, bunWhich, type ProcessRunner, type WhichFn } from "./secrets/process.ts";
import { type SecretBackend, SecretStore } from "./secrets/store.ts";

/** Everything environmental a run depends on; tests replace any of it. */
export interface RuntimeDeps {
  env: Env;
  home?: string | undefined;
  platform?: string | undefined;
  fetcher?: Fetcher | undefined;
  clock?: Clock | undefined;
  runProcess?: ProcessRunner | undefined;
  which?: WhichFn | undefined;
  secretBackends?: SecretBackend[] | undefined;
  clipboard?: Clipboard | undefined;
  /** Where --debug lines go (stderr in the CLI). */
  debugSink?: LineSink | undefined;
  /** Read retry policy override (tests). */
  retryConfig?: RetryConfig | undefined;
}

export interface RunOptions {
  profile?: string | undefined;
  config?: string | undefined;
  debug?: boolean | undefined;
  timeoutSeconds?: number | undefined;
  cachePolicy?: CachePolicy | undefined;
}

export const DEFAULT_TIMEOUT_SECONDS = 20;

export function defaultSecretBackends(deps: RuntimeDeps): SecretBackend[] {
  const run = deps.runProcess ?? bunProcessRunner;
  const which = deps.which ?? bunWhich;
  const home = deps.home ?? deps.env.HOME ?? homedir();
  return [
    createKeychainBackend(run, deps.platform ?? process.platform),
    createOnePasswordBackend(run, which),
    createEnvBackend(deps.env),
    createFileBackend(home),
  ];
}

/**
 * Builds the per-run context: paths, profile resolution (§6.6), lazy role-scoped SDK clients
 * (§5.3), secret store, and the meta collector for --json output.
 */
export async function createContext(deps: RuntimeDeps, options: RunOptions = {}): Promise<Ctx> {
  const env = deps.env;
  const home = deps.home ?? env.HOME ?? homedir();
  const platform = deps.platform ?? process.platform;
  const paths = resolvePaths(env, { configFlag: options.config, home });
  const store = new ProfileStore(paths.configFile, paths.stateFile);
  const loaded = await store.loadConfig();
  const state = await store.loadState();
  let profile: ResolvedProfile | null = null;
  let profileError: OrctlError | undefined;
  try {
    profile = resolveProfile({ flag: options.profile, env, config: loaded.config, state });
  } catch (err) {
    if (!(err instanceof OrctlError)) throw err;
    profileError = err;
  }
  const meta: OpMeta = emptyMeta();
  meta.warnings.push(...loaded.warnings);
  const secrets = new SecretStore(deps.secretBackends ?? defaultSecretBackends({ ...deps, home, platform }));
  const log = createLogger(
    Boolean(options.debug),
    deps.debugSink ?? ((line) => process.stderr.write(`${line}\n`)),
  );
  const timeoutMs = Math.round((options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000);
  const rateLimit: RateLimitInfo = {};
  const clientOptions = { fetcher: deps.fetcher, timeoutMs, log, rateLimit, retryConfig: deps.retryConfig };

  const clients = new Map<ApiRole, OpenRouter>();
  const keyedClient = (role: "user" | "management"): OpenRouter => {
    const existing = clients.get(role);
    if (existing) return existing;
    const ref = requireRef(profile, role, profileError);
    // The function form defers the Keychain/op read until a request actually needs the key.
    const client = createClient(role, async () => (await secrets.resolve(ref)).reveal(), clientOptions);
    clients.set(role, client);
    return client;
  };

  const sdk: SdkProvider = {
    rateLimit,
    public() {
      let client = clients.get("public");
      if (!client) {
        client = createClient("public", "", clientOptions);
        clients.set("public", client);
      }
      return client;
    },
    user: () => keyedClient("user"),
    management: () => keyedClient("management"),
    withKey(role, key: Secret) {
      return createClient(role, key.reveal(), clientOptions);
    },
  };

  const clipboard =
    deps.clipboard ??
    createSystemClipboard(deps.runProcess ?? bunProcessRunner, platform, deps.which ?? bunWhich);

  const clock = deps.clock ?? systemClock;
  return {
    env,
    home,
    paths,
    platform,
    profile,
    profileError,
    store,
    sdk,
    secrets,
    clipboard,
    cache: new DiskCache(paths.cacheDir, clock),
    clock,
    log,
    limiter: createLimiter(4),
    cachePolicy: options.cachePolicy ?? "default",
    timeoutMs,
    meta,
    memo: makeMemo(),
  };
}

function makeMemo(): Ctx["memo"] {
  const memo = new Map<string, Promise<unknown>>();
  return <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    let pending = memo.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = fn();
      memo.set(key, pending);
      pending.catch(() => memo.delete(key));
    }
    return pending;
  };
}

/**
 * A per-operation view of a long-lived context (the TUI keeps one per profile): SDK clients and
 * resolved secrets are shared, while meta and memoized lookups start fresh.
 */
export function forkContext(ctx: Ctx, overrides: Partial<Pick<Ctx, "cachePolicy">> = {}): Ctx {
  return { ...ctx, ...overrides, meta: emptyMeta(), memo: makeMemo() };
}

/** The key reference for a role, or a NO_CREDENTIAL error that names the fix (§6.7). */
export function requireRef(
  profile: ResolvedProfile | null,
  role: "user" | "management",
  profileError?: OrctlError,
): string {
  if (profileError) throw profileError;
  if (!profile) {
    throw new OrctlError("NO_CREDENTIAL", messages.noProfile, { hint: messages.addProfileHint });
  }
  const ref = role === "management" ? profile.managementRef : profile.userRef;
  if (!ref) {
    throw new OrctlError("NO_CREDENTIAL", messages.missingRole(profile.name, role), {
      hint: messages.missingRoleHint(profile.name, role),
    });
  }
  return ref;
}
