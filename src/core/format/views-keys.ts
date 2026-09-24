import type { KeyItem } from "../ops/keys.ts";
import type { Column } from "./columns.ts";
import { formatUsd, percentUsed } from "./money.ts";
import { daysUntil, formatDay, relativeTime, toDate } from "./time.ts";
import { kv, lines, type Style, table, type View } from "./view.ts";

export type KeyStatus = "active" | "disabled" | "expired";

export function keyStatus(k: Pick<KeyItem, "disabled" | "expiresAt">, now: Date): KeyStatus {
  if (k.disabled) return "disabled";
  const exp = toDate(k.expiresAt as Date | string | null | undefined);
  if (exp && exp.getTime() <= now.getTime()) return "expired";
  return "active";
}

/** "…1c96" from the server's masked label "sk-or-v1-0e6...1c96". */
export function shortLabel(label: string): string {
  const m = label.match(/([A-Za-z0-9]{2,})$/);
  return m ? `…${m[1]}` : label;
}

function limitCell(k: KeyItem): string {
  if (k.limit === null) return "—";
  return `${formatUsd(k.limit)} / ${formatUsd(k.limitRemaining)}`;
}

export function keyColumns(now: Date): Column<KeyItem>[] {
  return [
    { id: "name", header: "NAME", value: (k) => k.name, priority: 0 },
    { id: "label", header: "LABEL", value: (k) => shortLabel(k.label), priority: 1 },
    { id: "workspace", header: "WORKSPACE", value: (k) => k.workspaceSlug, priority: 2 },
    {
      id: "limit",
      header: "LIMIT / LEFT",
      value: limitCell,
      align: "right",
      priority: 1,
      tone: (k) => {
        const used = percentUsed(k.limit, k.limitRemaining);
        return used === null ? undefined : used >= 1 ? "bad" : used >= 0.8 ? "warn" : undefined;
      },
    },
    { id: "reset", header: "RESET", value: (k) => k.limitReset ?? "", priority: 3 },
    {
      id: "usage",
      header: "USAGE (MONTH)",
      value: (k) => formatUsd(k.usageMonthly),
      align: "right",
      priority: 2,
    },
    {
      id: "total",
      header: "USAGE (ALL)",
      value: (k) => formatUsd(k.usage),
      align: "right",
      priority: 4,
      optional: true,
    },
    {
      id: "expires",
      header: "EXPIRES",
      value: (k) => (k.expiresAt ? relativeTime(k.expiresAt as Date, now) : "never"),
      priority: 2,
      tone: (k) => {
        const d = daysUntil(k.expiresAt as Date | null, now);
        return d === null ? undefined : d <= 0 ? "bad" : d < 14 ? "warn" : undefined;
      },
    },
    {
      id: "status",
      header: "STATUS",
      value: (k) => keyStatus(k, now),
      priority: 1,
      tone: (k) => (keyStatus(k, now) === "active" ? "good" : "muted"),
    },
    { id: "created", header: "CREATED", value: (k) => formatDay(k.createdAt), priority: 4, optional: true },
    { id: "hash", header: "HASH", value: (k) => k.hash.slice(0, 12), priority: 4, optional: true },
  ];
}

export function keyDetailLines(k: KeyItem, s: Style, now: Date): string[] {
  const status = keyStatus(k, now);
  const rows: Array<[string, string]> = [
    ["Key", `${s.bold(k.name)} ${s.dim(k.label)}`],
    ["Hash", k.hash],
    [
      "Workspace",
      `${k.workspaceSlug}${k.workspaceName && k.workspaceName !== k.workspaceSlug ? ` (${k.workspaceName})` : ""}`,
    ],
    ["Status", s.tone(status === "active" ? "good" : "warn", status)],
    [
      "Limit",
      k.limit === null
        ? "no limit"
        : `${formatUsd(k.limit)}${k.limitReset ? ` ${k.limitReset}` : ""} · left ${formatUsd(k.limitRemaining)}${k.includeByokInLimit ? " · includes BYOK" : ""}`,
    ],
    [
      "Usage",
      `day ${formatUsd(k.usageDaily)} · week ${formatUsd(k.usageWeekly)} · month ${formatUsd(k.usageMonthly)} · all ${formatUsd(k.usage)}`,
    ],
  ];
  if (k.byokUsage)
    rows.push(["BYOK usage", `month ${formatUsd(k.byokUsageMonthly)} · all ${formatUsd(k.byokUsage)}`]);
  rows.push(["Created", formatDay(k.createdAt)]);
  rows.push([
    "Expires",
    k.expiresAt ? `${formatDay(k.expiresAt as Date)} (${relativeTime(k.expiresAt as Date, now)})` : "never",
  ]);
  if (k.externalUser) rows.push(["External user", k.externalUser]);
  if (k.creatorUserId) rows.push(["Creator", k.creatorUserId]);
  return kv(rows, s);
}

export interface CreditsResult {
  totalCredits: number;
  totalUsage: number;
  remaining: number;
}

export function creditsLines(c: CreditsResult, s: Style): string[] {
  const used = c.totalCredits > 0 ? Math.min(1, c.totalUsage / c.totalCredits) : 0;
  const width = 30;
  const filled = Math.round(used * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
  return [
    ...kv(
      [
        ["Credits", formatUsd(c.totalCredits)],
        ["Used", formatUsd(c.totalUsage)],
        [
          "Left",
          s.tone(
            c.remaining <= 0 ? "bad" : c.remaining < c.totalCredits * 0.1 ? "warn" : "good",
            formatUsd(c.remaining),
          ),
        ],
      ],
      s,
    ),
    `${s.tone(used > 0.9 ? "bad" : used > 0.75 ? "warn" : "accent", bar)} ${Math.round(used * 100)}% used`,
  ];
}

export const keyViews: Record<string, View> = {
  "keys.list": table<{ keys: KeyItem[]; workspaces: number; partial: string[] }, KeyItem>({
    rows: (o) => o.keys,
    columns: keyColumns,
    empty: "No keys. Create one with `orctl keys create <name>`.",
    footer: (o, s) => [
      s.dim(
        `${o.keys.length} key${o.keys.length === 1 ? "" : "s"} across ${o.workspaces} workspace${o.workspaces === 1 ? "" : "s"}${o.partial.length ? ` · missing: ${o.partial.join(", ")}` : ""}`,
      ),
    ],
  }),
  "keys.show": lines<KeyItem>((k, s, now) => keyDetailLines(k, s, now)),
  "credits.get": lines<CreditsResult>((c, s) => creditsLines(c, s)),
};
