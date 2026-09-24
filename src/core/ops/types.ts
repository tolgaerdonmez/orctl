import type { OpenRouter } from "@openrouter/sdk";
import type { z } from "zod";
import type { CachePolicy, DiskCache } from "../cache/disk-cache.ts";
import type { RateLimitInfo } from "../client/factory.ts";
import type { Clipboard } from "../clipboard.ts";
import type { OrctlError } from "../errors.ts";
import type { RedactingLogger } from "../logger.ts";
import type { Env, Paths } from "../paths.ts";
import type { ProfileStore } from "../profile/config-store.ts";
import type { ResolvedProfile } from "../profile/resolve.ts";
import type { Clock, Limiter } from "../runtime.ts";
import type { Secret } from "../secret.ts";
import type { SecretStore } from "../secrets/store.ts";

/**
 * The Operation registry is the single source of parity between the CLI and the TUI (plan §5.2):
 * every user action is one Operation; CLI flags and TUI forms both fill its zod input schema.
 */

/** "local" operations touch only orctl's own files (the plan's "—" role). */
export type Role = "local" | "public" | "user" | "management";
export type OpKind = "read" | "mutate" | "destructive";

export type OpId = `${string}.${string}`;

export interface OpMeta {
  warnings: string[];
  /** Workspaces (or other sources) that failed in a multi-source read (exit 11 with --strict). */
  partial: string[];
  notes: string[];
  cached: boolean;
  fetchedAt?: string | undefined;
  workspaces?: number | undefined;
  /** Overrides the success exit code (doctor reports its first failing check this way). */
  exit?: number | undefined;
}

export interface SdkProvider {
  public(): OpenRouter;
  user(): OpenRouter;
  management(): OpenRouter;
  /** A client bound to an explicit key (profile verification, rotate --verify). */
  withKey(role: "user" | "management", key: Secret): OpenRouter;
  readonly rateLimit: RateLimitInfo;
}

export type { CachePolicy } from "../cache/disk-cache.ts";

export interface Ctx {
  readonly env: Env;
  readonly home: string;
  readonly paths: Paths;
  readonly platform: string;
  /** Null when no profile is configured; only local and public operations run then. */
  readonly profile: ResolvedProfile | null;
  /** Set when an explicitly requested profile (-p, ORCTL_PROFILE) does not exist. */
  readonly profileError?: OrctlError | undefined;
  readonly store: ProfileStore;
  readonly sdk: SdkProvider;
  readonly secrets: SecretStore;
  readonly clipboard: Clipboard;
  /** Public data only (models, providers, endpoints); never account data (plan K19). */
  readonly cache: DiskCache;
  /** Adapter hook for a key that could be neither delivered nor deleted again (plan §8.1). */
  readonly emergencyReveal?: ((secret: Secret, message: string) => Promise<void>) | undefined;
  readonly askDelivery?:
    | ((choices: Array<"store" | "show" | "copy">) => Promise<"store" | "show" | "copy">)
    | undefined;
  readonly clock: Clock;
  readonly log: RedactingLogger;
  readonly limiter: Limiter;
  readonly cachePolicy: CachePolicy;
  readonly timeoutMs: number;
  readonly meta: OpMeta;
  /** Per-run memoization (workspace list, key list) so reference resolution does not refetch. */
  memo<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/** What a destructive operation needs confirmed, shown before it runs (plan §6.10). */
export interface Confirmation {
  /** One-line description including profile and workspace, e.g. `Delete key "ci-bot" (…1c96)…?` */
  prompt: string;
  /** When set, the user must type this exact text (a key or workspace name). */
  typed?: string | undefined;
}

export interface Operation<I = unknown, O = unknown> {
  readonly id: OpId;
  readonly role: Role;
  readonly kind: OpKind;
  readonly summary: string;
  readonly input: z.ZodType<I>;
  run(ctx: Ctx, input: I, signal?: AbortSignal): Promise<O>;
  /** Destructive operations describe what they are about to do; adapters ask for confirmation. */
  confirm?(ctx: Ctx, input: I): Promise<Confirmation>;
  /** When true the op may run without a resolved profile even though its role needs a key. */
  readonly profileOptional?: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: registry holds heterogeneous operations.
export type AnyOperation = Operation<any, any>;

export function defineOp<S extends z.ZodType, O>(
  op: Omit<Operation<z.output<S>, O>, "input"> & { input: S },
): Operation<z.output<S>, O> {
  return op as unknown as Operation<z.output<S>, O>;
}

export function emptyMeta(): OpMeta {
  return { warnings: [], partial: [], notes: [], cached: false };
}
