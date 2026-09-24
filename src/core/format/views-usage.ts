import type { KeyUsageRow, UsageReport, UsageRow } from "../ops/usage.ts";
import type { Column } from "./columns.ts";
import { formatUsd } from "./money.ts";
import { type Style, table, type View } from "./view.ts";

export function spendBar(share: number, width = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, share)) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

const pct = (share: number) => `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;
const n = (v: number) => v.toLocaleString("en-US");

const GROUP_HEADER = {
  model: "MODEL",
  provider: "PROVIDER",
  day: "DAY",
  workspace: "WORKSPACE",
  key: "KEY",
} as const;

export function activityColumns(by: UsageReport["by"]): Column<UsageRow>[] {
  return [
    { id: "group", header: GROUP_HEADER[by], value: (r) => r.group, priority: 0 },
    { id: "usage", header: "USAGE", value: (r) => formatUsd(r.usage), align: "right", priority: 0 },
    { id: "share", header: "SHARE", value: (r) => pct(r.share), align: "right", priority: 1 },
    { id: "bar", header: "", value: (r) => spendBar(r.share), priority: 3, tone: () => "accent" },
    { id: "requests", header: "REQUESTS", value: (r) => n(r.requests), align: "right", priority: 2 },
    { id: "prompt", header: "PROMPT TOK", value: (r) => n(r.promptTokens), align: "right", priority: 3 },
    {
      id: "completion",
      header: "COMPL TOK",
      value: (r) => n(r.completionTokens),
      align: "right",
      priority: 3,
    },
    {
      id: "reasoning",
      header: "REASON TOK",
      value: (r) => n(r.reasoningTokens),
      align: "right",
      priority: 4,
    },
    {
      id: "byok",
      header: "BYOK",
      value: (r) => formatUsd(r.byokUsage),
      align: "right",
      priority: 4,
      optional: true,
    },
  ];
}

export const keyUsageColumns: Column<KeyUsageRow>[] = [
  { id: "group", header: "KEY", value: (r) => r.group, priority: 0 },
  { id: "workspace", header: "WORKSPACE", value: (r) => r.workspace, priority: 2 },
  { id: "day", header: "TODAY", value: (r) => formatUsd(r.day), align: "right", priority: 2 },
  { id: "week", header: "WEEK", value: (r) => formatUsd(r.week), align: "right", priority: 1 },
  { id: "month", header: "MONTH", value: (r) => formatUsd(r.month), align: "right", priority: 0 },
  { id: "total", header: "ALL TIME", value: (r) => formatUsd(r.total), align: "right", priority: 1 },
  { id: "share", header: "SHARE", value: (r) => pct(r.share), align: "right", priority: 2 },
  { id: "bar", header: "", value: (r) => spendBar(r.share), priority: 3, tone: () => "accent" },
];

export function usageFooter(o: UsageReport, s: Style): string[] {
  if (o.source === "key-counters") {
    const t = o.totals as { day: number; week: number; month: number; total: number };
    return [
      s.bold(
        `Total  today ${formatUsd(t.day)} · week ${formatUsd(t.week)} · month ${formatUsd(t.month)} · all ${formatUsd(t.total)}`,
      ),
      s.dim("Source: per-key usage counters (activity rows carry no key); share is of this month."),
    ];
  }
  const t = o.totals as Omit<UsageRow, "group" | "share">;
  return [
    s.bold(
      `Total  ${formatUsd(t.usage)} · ${n(t.requests)} requests · ${n(t.promptTokens + t.completionTokens)} tokens`,
    ),
    s.dim(`${o.since} … ${o.until} (UTC) · source: GET /activity, last 30 completed days`),
  ];
}

export const usageViews: Record<string, View> = {
  "usage.report": table<UsageReport, UsageRow | KeyUsageRow>({
    rows: (o) => o.rows,
    columns: (_now, o) =>
      (o.source === "key-counters" ? keyUsageColumns : activityColumns(o.by)) as Column<
        UsageRow | KeyUsageRow
      >[],
    empty: "No usage in this window.",
    footer: (o, s) => usageFooter(o, s),
  }),
};
