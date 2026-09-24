import type { OpenRouter } from "@openrouter/sdk";
import { mapError } from "../client/map-error.ts";
import type { OrctlErrorJson } from "../errors.ts";
import { messages } from "../messages.ts";
import { withTimeout } from "../runtime.ts";
import type { Secret } from "../secret.ts";

/**
 * Server-side role verification (plan §6.7). The key prefix is only a hint; the server decides:
 * a 200 from GET /credits proves a management key, a 200 from GET /key proves a usable user key.
 */

export const PROBE_TIMEOUT_MS = 5_000;

export interface Credits {
  total: number;
  used: number;
  remaining: number;
}

export interface ManagementProbe {
  ok: true;
  credits: Credits;
  workspaces?: { count: number; names: string[] } | undefined;
}

export interface UserProbe {
  ok: true;
  label: string;
  limit: number | null;
  limitRemaining: number | null;
  limitReset: string | null;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  isFreeTier: boolean;
  isManagementKey: boolean;
  isProvisioningKey: boolean;
  freeModelDailyRequests: { limit: number; used: number; remaining: number };
  expiresAt: string | null;
  workspaceId: string | null;
}

export interface ProbeFailure {
  ok: false;
  error: OrctlErrorJson;
}

export async function probeManagement(
  client: OpenRouter,
  opts: { timeoutMs?: number; withWorkspaces?: boolean } = {},
): Promise<ManagementProbe> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const res = await withTimeout(
    client.credits.getCredits(undefined, { timeoutMs, retries: { strategy: "none" } }),
    timeoutMs,
  );
  const credits = {
    total: res.data.totalCredits,
    used: res.data.totalUsage,
    remaining: res.data.totalCredits - res.data.totalUsage,
  };
  if (!opts.withWorkspaces) return { ok: true, credits };
  try {
    const page = await withTimeout(
      client.workspaces.list({ limit: 100 }, { timeoutMs, retries: { strategy: "none" } }),
      timeoutMs,
    );
    const data = page.result.data;
    return {
      ok: true,
      credits,
      workspaces: { count: page.result.totalCount ?? data.length, names: data.map((w) => w.slug) },
    };
  } catch {
    return { ok: true, credits };
  }
}

export async function probeUser(client: OpenRouter, opts: { timeoutMs?: number } = {}): Promise<UserProbe> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const res = await withTimeout(
    client.apiKeys.getCurrentKeyMetadata(undefined, { timeoutMs, retries: { strategy: "none" } }),
    timeoutMs,
  );
  const d = res.data;
  return {
    ok: true,
    label: d.label,
    limit: d.limit,
    limitRemaining: d.limitRemaining,
    limitReset: d.limitReset,
    usage: d.usage,
    usageDaily: d.usageDaily,
    usageWeekly: d.usageWeekly,
    usageMonthly: d.usageMonthly,
    isFreeTier: d.isFreeTier,
    isManagementKey: d.isManagementKey,
    isProvisioningKey: d.isProvisioningKey,
    freeModelDailyRequests: d.freeModelDailyRequests,
    expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
    workspaceId: d.workspaceId,
  };
}

export function failure(err: unknown, role: "management" | "user", profile?: string): ProbeFailure {
  return { ok: false, error: mapError(err, { role, profile }).toJSON() };
}

/** Prefix plausibility check; returns a warning, never blocks (plan §6.7). */
export function prefixWarning(role: "management" | "user", key: Secret): string | undefined {
  const value = key.reveal();
  const expected = role === "management" ? "sk-or-mgmt-" : "sk-or-v1-";
  if (value.startsWith(expected)) return undefined;
  const prefix = value.match(/^sk-or-[a-z0-9]+-/)?.[0] ?? value.slice(0, 6);
  return messages.prefixMismatch(role, prefix);
}
