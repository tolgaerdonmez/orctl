import { useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import type { OrctlError } from "../../core/errors.ts";
import { formatDay } from "../../core/format/time.ts";
import { keyColumns } from "../../core/format/views-keys.ts";
import { budgetColumns, memberColumns, workspaceColumns } from "../../core/format/views-workspaces.ts";
import {
  BUDGET_INTERVALS,
  type Workspace,
  type WorkspaceBudget,
  type WorkspaceDetail,
} from "../../core/ops/workspaces.ts";
import { DataTable, listKeys } from "../components/DataTable.tsx";
import { Confirm, ConfirmTyped } from "../components/dialogs.tsx";
import { TextField } from "../components/fields.tsx";
import { MODAL_CONTENT, Modal } from "../components/Modal.tsx";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { type TuiState, useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";
import type { KeysResult } from "./Keys.tsx";

async function invalidateWorkspaces(tui: TuiState): Promise<void> {
  await tui.queryClient.invalidateQueries({
    predicate: (q) => {
      const op = String(q.queryKey[1] ?? "");
      return op.startsWith("workspaces.") || op.startsWith("budgets.") || op.startsWith("keys.");
    },
  });
}

/** Workspaces (plan §7.3): list; enter opens the detail with Budgets, Members and Keys tabs. */
export function WorkspacesScreen() {
  const tui = useTui();
  const dims = useTerminalDimensions();
  const [selected, setSelected] = useState(0);
  const list = useOp<{ workspaces: Workspace[] }>("workspaces.list", {});
  const rows = list.data?.workspaces ?? [];
  const current = rows[Math.min(selected, Math.max(0, rows.length - 1))];
  useCliHint("workspaces.list", {});
  useKeys((id) => {
    if (listKeys(id, rows.length, selected, setSelected)) return true;
    if (id === "enter" && current) {
      tui.push({ id: "workspace-detail", params: { ref: current.id } });
      return true;
    }
    if (id === "n") {
      tui.push({ id: "workspace-form", params: { mode: "create" } });
      return true;
    }
    return false;
  });
  return (
    <Panel title="Workspaces">
      {list.isLoading ? <text fg={theme.muted}>Loading…</text> : null}
      {list.error ? <text fg={theme.bad}>{`✖ ${list.error.message}`}</text> : null}
      <DataTable
        columns={workspaceColumns}
        rows={rows}
        selected={selected}
        width={Math.max(40, dims.width - 6)}
        height={Math.max(4, dims.height - 9)}
        empty={list.data ? "No workspaces." : ""}
        rowKey={(w) => w.id}
      />
      <text fg={theme.dim}>enter details · n new workspace</text>
    </Panel>
  );
}

const TABS = ["Budgets", "Members", "Keys"] as const;

export function WorkspaceDetailScreen(props: { ref: string }) {
  const tui = useTui();
  const dims = useTerminalDimensions();
  const [tab, setTab] = useState(0);
  const [selected, setSelected] = useState(0);
  const detail = useOp<WorkspaceDetail>("workspaces.show", { ref: props.ref });
  const keys = useOp<KeysResult>(
    "keys.list",
    { workspace: props.ref, includeDisabled: true },
    { enabled: tab === 2 },
  );
  const d = detail.data;
  const slug = d?.workspace.slug ?? props.ref;
  const fail = (err: unknown) => tui.toast((err as OrctlError).message ?? String(err), "bad");
  const hint =
    tab === 0
      ? ["budgets.list", { ref: slug }]
      : tab === 1
        ? ["workspaces.members", { ref: slug }]
        : ["keys.list", { workspace: slug }];
  useCliHint(hint[0] as string, hint[1] as Record<string, unknown>);
  const budgets = d?.budgets ?? [];
  const count =
    tab === 0 ? budgets.length : tab === 1 ? (d?.members.length ?? 0) : (keys.data?.keys.length ?? 0);

  useKeys((id) => {
    if (listKeys(id, count, selected, setSelected)) return true;
    if (id === "tab" || id === "right" || id === "left") {
      setTab((t) => (t + (id === "left" ? TABS.length - 1 : 1)) % TABS.length);
      setSelected(0);
      return true;
    }
    if (!d) return false;
    if (id === "e" && tab !== 0) {
      tui.push({ id: "workspace-form", params: { mode: "edit", ref: d.workspace.id } });
      return true;
    }
    if (id === "D" && tab !== 0) {
      tui.openModal(
        <ConfirmTyped
          title="Delete workspace"
          prompt={`Delete workspace "${d.workspace.name}" (${slug}) in profile ${tui.profile?.name ?? "env"}? Its keys and budgets go with it.`}
          typed={slug}
          onConfirm={() =>
            tui
              .runOp("workspaces.delete", { ref: d.workspace.id })
              .then(async () => {
                tui.toast(`Deleted workspace ${slug}`, "good");
                await invalidateWorkspaces(tui);
                tui.pop();
              })
              .catch(fail)
          }
        />,
      );
      return true;
    }
    if (tab === 0 && (id === "e" || id === "n")) {
      const b = id === "e" ? budgets[selected] : undefined;
      tui.openModal(
        <BudgetForm workspace={d.workspace} budget={b} onSaved={() => void invalidateWorkspaces(tui)} />,
      );
      return true;
    }
    if (tab === 0 && id === "D") {
      const b = budgets[selected];
      if (!b) return true;
      const interval = b.resetInterval ?? "lifetime";
      tui.openModal(
        <Confirm
          title="Remove budget"
          prompt={`Remove the ${interval} budget of workspace "${slug}" in profile ${tui.profile?.name ?? "env"}?`}
          onConfirm={() =>
            tui
              .runOp("budgets.delete", { ref: d.workspace.id, interval })
              .then(async () => {
                tui.toast(`Removed the ${interval} budget`, "good");
                await invalidateWorkspaces(tui);
              })
              .catch(fail)
          }
        />,
      );
      return true;
    }
    return false;
  });

  const now = tui.ctx?.clock.now() ?? new Date();
  const width = Math.max(40, dims.width - 6);
  const height = Math.max(4, dims.height - 13);
  return (
    <Panel title={d ? `Workspace ${d.workspace.name}` : "Workspace"}>
      {detail.isLoading ? <text fg={theme.muted}>Loading…</text> : null}
      {detail.error ? <text fg={theme.bad}>{`✖ ${detail.error.message}`}</text> : null}
      {d ? (
        <text fg={theme.fg}>
          {`${d.workspace.slug} · ${d.workspace.id} · created ${formatDay(d.workspace.createdAt)} · ${d.keys < 0 ? "?" : d.keys} keys · ${d.members.length} members${d.workspace.description ? ` · ${d.workspace.description}` : ""}`}
        </text>
      ) : null}
      <text>
        {TABS.map((t, i) => (
          <span
            key={t}
            fg={i === tab ? theme.selectionFg : theme.muted}
            bg={i === tab ? theme.selectionBg : undefined}
          >
            {` ${t} `}
          </span>
        ))}
        <span fg={theme.dim}>{"   tab switch"}</span>
      </text>
      {tab === 0 ? (
        <>
          {d?.includeByokInBudgets ? <text fg={theme.muted}>BYOK usage counts toward budgets.</text> : null}
          <DataTable
            columns={budgetColumns}
            rows={budgets}
            selected={selected}
            width={width}
            height={height}
            empty="No budgets."
          />
          <text fg={theme.dim}>n add · e change · D remove</text>
        </>
      ) : null}
      {tab === 1 ? (
        <>
          <DataTable
            columns={memberColumns}
            rows={d?.members ?? []}
            selected={selected}
            width={width}
            height={height}
            empty="No members."
          />
          <text fg={theme.dim}>
            Membership is read-only in orctl v1. · e edit workspace · D delete workspace
          </text>
        </>
      ) : null}
      {tab === 2 ? (
        <>
          <DataTable
            columns={keyColumns(now).filter((c) =>
              ["name", "label", "limit", "usage", "expires", "status"].includes(c.id),
            )}
            rows={keys.data?.keys ?? []}
            selected={selected}
            width={width}
            height={height}
            empty={keys.data ? "No keys in this workspace." : "Loading…"}
            rowKey={(k) => k.hash}
          />
          <text fg={theme.dim}>e edit workspace · D delete workspace</text>
        </>
      ) : null}
    </Panel>
  );
}

/** Budget form (plan §7.3 Bütçeler → e): the same fields as `orctl workspaces budget set`. */
function BudgetForm(props: { workspace: Workspace; budget?: WorkspaceBudget | undefined; onSaved(): void }) {
  const tui = useTui();
  const initialInterval = props.budget ? (props.budget.resetInterval ?? "lifetime") : "monthly";
  const [interval, setInterval] = useState<string>(initialInterval);
  const [usd, setUsd] = useState(props.budget ? String(props.budget.limitUsd) : "");
  const [byok, setByok] = useState(false);
  const [row, setRow] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useCliHint("budgets.set", {
    ref: props.workspace.slug,
    interval,
    usd: Number(usd) || 0,
    ...(byok ? { includeByok: true } : {}),
  });
  const save = () => {
    const n = Number(usd);
    if (!usd.trim() || !Number.isFinite(n) || n < 0) return setError("Enter a USD amount.");
    tui
      .runOp("budgets.set", {
        ref: props.workspace.id,
        interval,
        usd: n,
        ...(byok ? { includeByok: true } : {}),
      })
      .then(() => {
        tui.closeModal();
        tui.toast(`${interval} budget set to $${n}`, "good");
        props.onSaved();
      })
      .catch((e: OrctlError) => setError(e.message));
  };
  useKeys((id) => {
    if (id === "up" || id === "down" || id === "tab") {
      setRow((r) => (r + (id === "up" ? 3 : 1)) % 4);
      return true;
    }
    if (row === 0 && (id === "left" || id === "right" || id === "space")) {
      const i = BUDGET_INTERVALS.indexOf(interval as (typeof BUDGET_INTERVALS)[number]);
      setInterval(BUDGET_INTERVALS[(i + (id === "left" ? 3 : 1)) % 4] ?? "monthly");
      return true;
    }
    if (row === 2 && (id === "space" || id === "enter")) {
      setByok((v) => !v);
      return true;
    }
    if (row === 3 && id === "enter") {
      save();
      return true;
    }
    return false;
  }, MODAL_CONTENT + 1);
  const sel = (i: number) =>
    row === i ? { fg: theme.selectionFg, bg: theme.selectionBg } : { fg: theme.fg };
  return (
    <Modal title={`Budget for ${props.workspace.slug}`} onClose={tui.closeModal} height={9} width={64}>
      <text {...sel(0)}>{`Interval     ‹ ${interval} ›`}</text>
      <TextField
        focused={row === 1}
        priority={MODAL_CONTENT}
        label="Limit USD   "
        initial={usd}
        width={20}
        onChange={setUsd}
        onSubmit={() => setRow(2)}
        onEscape={tui.closeModal}
      />
      <text {...sel(2)}>{`Include BYOK [${byok ? "x" : " "}]`}</text>
      <text {...sel(3)}>{"  Save  "}</text>
      {error ? <text fg={theme.bad}>{`✖ ${error}`}</text> : null}
    </Modal>
  );
}

/** Create or edit a workspace (plan §7.3 Workspaces → n, detail → e). */
export function WorkspaceForm(props: { mode: "create" | "edit"; ref?: string }) {
  const tui = useTui();
  const editing = props.mode === "edit";
  const detail = useOp<WorkspaceDetail>("workspaces.show", { ref: props.ref ?? "" }, { enabled: editing });
  const [values, setValues] = useState<Record<string, string>>({});
  const [row, setRow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fields = [
    { field: "name", label: "Name", placeholder: detail.data?.workspace.name ?? "Research" },
    { field: "slug", label: "Slug", placeholder: detail.data?.workspace.slug ?? "(from the name)" },
    { field: "description", label: "Description", placeholder: detail.data?.workspace.description ?? "" },
  ];
  const input: Record<string, unknown> = editing ? { ref: detail.data?.workspace.slug ?? props.ref } : {};
  for (const f of fields) {
    const v = values[f.field]?.trim();
    if (v) input[f.field] = v;
  }
  useCliHint(editing ? "workspaces.update" : "workspaces.create", input);
  const submit = () => {
    if (!editing && !input.name) return setError("A name is required.");
    tui
      .runOp(
        editing ? "workspaces.update" : "workspaces.create",
        editing ? { ...input, ref: props.ref } : input,
      )
      .then(async () => {
        tui.toast(editing ? "Workspace updated" : "Workspace created", "good");
        await invalidateWorkspaces(tui);
        tui.pop();
      })
      .catch((e: OrctlError) => setError(e.message));
  };
  useKeys((id) => {
    if (id === "up" || id === "down" || id === "tab") {
      setRow((r) => (r + (id === "up" ? fields.length : 1)) % (fields.length + 1));
      return true;
    }
    if (id === "enter" && row === fields.length) {
      submit();
      return true;
    }
    if (id === "escape") {
      tui.pop();
      return true;
    }
    return false;
  });
  return (
    <Panel title={editing ? `Edit workspace ${detail.data?.workspace.slug ?? ""}` : "New workspace"}>
      {fields.map((f, i) => (
        <TextField
          key={f.field}
          focused={row === i}
          label={f.label.padEnd(12)}
          placeholder={f.placeholder}
          width={44}
          onChange={(v) => setValues((s) => ({ ...s, [f.field]: v }))}
          onSubmit={() => setRow(i + 1)}
          onEscape={tui.pop}
        />
      ))}
      <text
        fg={row === fields.length ? theme.selectionFg : theme.accent}
        bg={row === fields.length ? theme.selectionBg : undefined}
      >
        {editing ? "  Save  " : "  Create  "}
      </text>
      {error ? <text fg={theme.bad}>{`✖ ${error}`}</text> : null}
      <text fg={theme.dim}>↑↓ move · enter next/submit · esc cancel</text>
    </Panel>
  );
}
