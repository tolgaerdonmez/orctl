import type { Workspace, WorkspaceBudget, WorkspaceMember } from "@openrouter/sdk/models";
import type { WorkspaceDetail } from "../ops/workspaces.ts";
import type { Column } from "./columns.ts";
import { formatUsd } from "./money.ts";
import { formatDay } from "./time.ts";
import { kv, lines, type Style, table, type View } from "./view.ts";

export const workspaceColumns: Column<Workspace>[] = [
  { id: "slug", header: "SLUG", value: (w) => w.slug, priority: 0 },
  { id: "name", header: "NAME", value: (w) => w.name, priority: 1 },
  { id: "description", header: "DESCRIPTION", value: (w) => w.description ?? "", priority: 3 },
  { id: "created", header: "CREATED", value: (w) => formatDay(w.createdAt), priority: 2 },
  { id: "id", header: "ID", value: (w) => w.id, priority: 4, optional: true },
];

export const budgetColumns: Column<WorkspaceBudget>[] = [
  { id: "interval", header: "INTERVAL", value: (b) => b.resetInterval ?? "lifetime", priority: 0 },
  { id: "limit", header: "LIMIT", value: (b) => formatUsd(b.limitUsd), align: "right", priority: 0 },
  { id: "updated", header: "UPDATED", value: (b) => formatDay(b.updatedAt), priority: 1 },
];

export const memberColumns: Column<WorkspaceMember>[] = [
  { id: "user", header: "USER", value: (m) => m.userId, priority: 0 },
  { id: "role", header: "ROLE", value: (m) => String(m.role), priority: 0 },
  { id: "since", header: "SINCE", value: (m) => formatDay(m.createdAt), priority: 1 },
];

export function workspaceDetailLines(d: WorkspaceDetail, s: Style): string[] {
  const w = d.workspace;
  const out = kv(
    [
      ["Workspace", `${s.bold(w.name)} (${w.slug})`],
      ["Id", w.id],
      ["Description", w.description ?? "—"],
      ["Created", formatDay(w.createdAt)],
      ["Keys", d.keys < 0 ? "unknown" : String(d.keys)],
      ["Members", String(d.members.length)],
    ],
    s,
  );
  out.push("", s.bold(`Budgets${d.includeByokInBudgets ? " (BYOK included)" : ""}`));
  if (d.budgets.length === 0) out.push(s.dim("  none"));
  for (const b of d.budgets)
    out.push(`  ${(b.resetInterval ?? "lifetime").padEnd(9)} ${formatUsd(b.limitUsd)}`);
  if (d.members.length) {
    out.push("", s.bold("Members"));
    for (const m of d.members.slice(0, 20)) out.push(`  ${m.userId} · ${m.role}`);
    if (d.members.length > 20)
      out.push(s.dim(`  … ${d.members.length - 20} more (orctl workspaces members ${w.slug})`));
  }
  return out;
}

type Named = { workspace: { slug: string } };

export const workspaceViews: Record<string, View> = {
  "workspaces.list": table<{ workspaces: Workspace[] }, Workspace>({
    rows: (o) => o.workspaces,
    columns: workspaceColumns,
    empty: "No workspaces.",
  }),
  "workspaces.show": lines<WorkspaceDetail>((d, s) => workspaceDetailLines(d, s)),
  "workspaces.create": lines<Workspace>((w, s) => [
    `${s.tone("good", "✔")} Created workspace "${w.name}" (${w.slug}, ${w.id})`,
  ]),
  "workspaces.update": lines<Workspace>((w, s) => [
    `${s.tone("good", "✔")} Updated workspace "${w.name}" (${w.slug})`,
  ]),
  "workspaces.delete": lines<{ name: string; slug: string }>((o, s) => [
    `${s.tone("good", "✔")} Deleted workspace "${o.name}" (${o.slug})`,
  ]),
  "workspaces.members": table<{ members: WorkspaceMember[] } & Named, WorkspaceMember>({
    rows: (o) => o.members,
    columns: memberColumns,
    empty: "No members.",
    header: (o, s) => [s.dim(`Members of ${o.workspace.slug} (read-only in orctl v1)`)],
  }),
  "budgets.list": table<
    { budgets: WorkspaceBudget[]; includeByokInBudgets: boolean } & Named,
    WorkspaceBudget
  >({
    rows: (o) => o.budgets,
    columns: budgetColumns,
    empty: "No budgets. Set one with `orctl workspaces budget set <workspace> monthly <usd>`.",
    header: (o, s) => [
      s.dim(`Budgets of ${o.workspace.slug}${o.includeByokInBudgets ? " · BYOK usage included" : ""}`),
    ],
  }),
  "budgets.set": lines<{ budget: WorkspaceBudget } & Named>((o, s) => [
    `${s.tone("good", "✔")} ${o.budget.resetInterval ?? "lifetime"} budget of ${o.workspace.slug} set to ${formatUsd(o.budget.limitUsd)}`,
  ]),
  "budgets.delete": lines<{ workspace: string; interval: string }>((o, s) => [
    `${s.tone("good", "✔")} Removed the ${o.interval} budget of ${o.workspace}`,
  ]),
};
