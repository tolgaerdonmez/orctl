import type { ActivityItem } from "@openrouter/sdk/models";
import { z } from "zod";
import { usageError } from "../errors.ts";
import { listAllKeys, resolveKey } from "./keys.ts";
import { type Ctx, defineOp } from "./types.ts";
import { listWorkspaces, resolveWorkspace } from "./workspace-ref.ts";

/**
 * Usage (plan §8.5). GET /activity returns the last 30 completed UTC days as rows of
 * date × model × endpoint × provider (× workspace with group_by=workspace). One call is made and
 * the breakdown is computed locally. Rows carry no key; `--by key` therefore uses the per-key
 * usage counters from the key list instead, and says so.
 */
export const USAGE_BY = ["model", "provider", "day", "workspace", "key"] as const;
export type UsageBy = (typeof USAGE_BY)[number];
export const ACTIVITY_DAYS = 30;
const DAY_MS = 86_400_000;

export interface UsageRow {
  group: string;
  usage: number;
  byokUsage: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  share: number;
}

export interface KeyUsageRow {
  group: string;
  workspace: string;
  hash: string;
  day: number;
  week: number;
  month: number;
  total: number;
  share: number;
}

export interface UsageReport {
  by: UsageBy;
  source: "activity" | "key-counters";
  since: string | null;
  until: string | null;
  rows: UsageRow[] | KeyUsageRow[];
  totals: Omit<UsageRow, "group" | "share"> | { day: number; week: number; month: number; total: number };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const UsageInput = z.object({
  by: z.enum(USAGE_BY).default("model"),
  since: z.string().regex(DATE, "use YYYY-MM-DD").optional(),
  until: z.string().regex(DATE, "use YYYY-MM-DD").optional(),
  days: z.number().int().positive().optional(),
  key: z.string().optional(),
  workspace: z.string().optional(),
});
export type UsageInput = z.infer<typeof UsageInput>;

/** The inclusive [since, until] window as YYYY-MM-DD, validated against the 30-day horizon. */
export function usageWindow(
  input: Pick<UsageInput, "since" | "until" | "days">,
  now: Date,
): { since: string; until: string } {
  if (input.days && (input.since || input.until))
    throw usageError("Use --days or --since/--until, not both.");
  const today = now.toISOString().slice(0, 10);
  const earliest = new Date(now.getTime() - ACTIVITY_DAYS * DAY_MS).toISOString().slice(0, 10);
  const since = input.days
    ? new Date(now.getTime() - input.days * DAY_MS).toISOString().slice(0, 10)
    : (input.since ?? earliest);
  const until = input.until ?? today;
  if (since < earliest || (input.days !== undefined && input.days > ACTIVITY_DAYS)) {
    throw usageError(
      `The API only returns the last ${ACTIVITY_DAYS} days (from ${earliest}).`,
      "Use --days 30 or a later --since.",
    );
  }
  if (until < since) throw usageError(`--until ${until} is before --since ${since}.`);
  return { since, until };
}

export function aggregateActivity(
  items: readonly ActivityItem[],
  by: Exclude<UsageBy, "key">,
  window: { since: string; until: string },
  workspaceName: (id: string | undefined) => string = (id) => id ?? "default",
): { rows: UsageRow[]; totals: Omit<UsageRow, "group" | "share"> } {
  const groups = new Map<string, UsageRow>();
  const totals = {
    usage: 0,
    byokUsage: 0,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
  };
  for (const it of items) {
    const day = it.date.slice(0, 10);
    if (day < window.since || day > window.until) continue;
    const group =
      by === "model"
        ? it.model
        : by === "provider"
          ? it.providerName
          : by === "day"
            ? day
            : workspaceName(it.workspaceId);
    let row = groups.get(group);
    if (!row) {
      row = {
        group,
        usage: 0,
        byokUsage: 0,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        share: 0,
      };
      groups.set(group, row);
    }
    row.usage += it.usage;
    row.byokUsage += it.byokUsageInference;
    row.requests += it.requests;
    row.promptTokens += it.promptTokens;
    row.completionTokens += it.completionTokens;
    row.reasoningTokens += it.reasoningTokens;
    totals.usage += it.usage;
    totals.byokUsage += it.byokUsageInference;
    totals.requests += it.requests;
    totals.promptTokens += it.promptTokens;
    totals.completionTokens += it.completionTokens;
    totals.reasoningTokens += it.reasoningTokens;
  }
  const rows = [...groups.values()];
  for (const r of rows) r.share = totals.usage > 0 ? r.usage / totals.usage : 0;
  rows.sort(
    by === "day"
      ? (a, b) => a.group.localeCompare(b.group)
      : (a, b) => b.usage - a.usage || a.group.localeCompare(b.group),
  );
  return { rows, totals };
}

export async function usageReport(ctx: Ctx, input: UsageInput): Promise<UsageReport> {
  const now = ctx.clock.now();
  if (input.by === "key") {
    if (input.since || input.until || input.days) {
      ctx.meta.warnings.push(
        "--by key uses the per-key counters (day/week/month/all-time); --since/--until/--days do not apply.",
      );
    }
    const { keys } = await listAllKeys(ctx, { workspace: input.workspace, includeDisabled: true });
    const selected = input.key ? [await resolveKey(ctx, input.key, input.workspace)] : keys;
    const rows: KeyUsageRow[] = selected
      .map((k) => ({
        group: k.name,
        workspace: k.workspaceSlug,
        hash: k.hash,
        day: k.usageDaily,
        week: k.usageWeekly,
        month: k.usageMonthly,
        total: k.usage,
        share: 0,
      }))
      .sort((a, b) => b.month - a.month || a.group.localeCompare(b.group));
    const totals = rows.reduce(
      (t, r) => ({
        day: t.day + r.day,
        week: t.week + r.week,
        month: t.month + r.month,
        total: t.total + r.total,
      }),
      { day: 0, week: 0, month: 0, total: 0 },
    );
    for (const r of rows) r.share = totals.month > 0 ? r.month / totals.month : 0;
    ctx.meta.notes.push("Source: per-key usage counters from the key list (activity rows carry no key).");
    return { by: "key", source: "key-counters", since: null, until: null, rows, totals };
  }
  const window = usageWindow(input, now);
  const workspace = input.workspace ? await resolveWorkspace(ctx, input.workspace) : undefined;
  const key = input.key ? await resolveKey(ctx, input.key, input.workspace) : undefined;
  const res = await ctx.sdk.management().analytics.getUserActivity({
    ...(key ? { apiKeyHash: key.hash } : {}),
    ...(workspace ? { workspaceId: workspace.id } : {}),
    ...(input.by === "workspace" ? { groupBy: "workspace" as const } : {}),
  });
  let names = new Map<string, string>();
  if (input.by === "workspace") {
    const { workspaces } = await listWorkspaces(ctx);
    names = new Map(workspaces.map((w) => [w.id, w.slug]));
  }
  const { rows, totals } = aggregateActivity(res.data, input.by, window, (id) =>
    id ? (names.get(id) ?? id) : "default",
  );
  ctx.meta.notes.push("Source: GET /activity (last 30 completed UTC days).");
  return { by: input.by, source: "activity", since: window.since, until: window.until, rows, totals };
}

export const usageReportOp = defineOp({
  id: "usage.report",
  role: "management",
  kind: "read",
  summary: "Spending breakdown by model, provider, day, workspace or key",
  input: UsageInput,
  run: (ctx, input) => usageReport(ctx, input),
});
