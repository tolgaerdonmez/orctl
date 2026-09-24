import type { OrctlError } from "../../core/errors.ts";
import type { OpMeta } from "../../core/ops/types.ts";
import type { ResolvedProfile } from "../../core/profile/resolve.ts";
import { redactValue } from "../../core/redact.ts";
import { ORCTL_VERSION } from "../../core/version.ts";

/**
 * The versioned --json envelope (plan §5.5). The contract is additive only:
 *   {"ok":true,"data":…,"error":null,"meta":{op, profile, profile_source, …}}
 */
export interface EnvelopeMeta {
  op: string;
  profile: string | null;
  profile_source: string | null;
  workspaces?: number | undefined;
  partial: string[];
  cached: boolean;
  fetched_at: string | null;
  warnings: string[];
  notes: string[];
  orctl: string;
}

export function envelopeMeta(
  op: string,
  profile: ResolvedProfile | null,
  meta: OpMeta | undefined,
): EnvelopeMeta {
  return {
    op,
    profile: profile?.name ?? null,
    profile_source: profile?.source ?? null,
    ...(meta?.workspaces !== undefined ? { workspaces: meta.workspaces } : {}),
    partial: meta?.partial ?? [],
    cached: meta?.cached ?? false,
    fetched_at: meta?.fetchedAt ?? null,
    warnings: meta?.warnings ?? [],
    notes: meta?.notes ?? [],
    orctl: ORCTL_VERSION,
  };
}

/**
 * `data` is serialized as returned by the operation, except that any secret-looking string is
 * masked; the only exception is an explicitly requested `--show` key (field `key`).
 */
export function successEnvelope(
  data: unknown,
  meta: EnvelopeMeta,
  opts: { revealKey?: boolean } = {},
): string {
  const safe = opts.revealKey ? data : redactValue(data);
  return JSON.stringify({ ok: true, data: safe ?? null, error: null, meta }, null, 2);
}

export function errorEnvelope(error: OrctlError, meta: EnvelopeMeta): string {
  return JSON.stringify({ ok: false, data: null, error: redactValue(error.toJSON()), meta }, null, 2);
}
