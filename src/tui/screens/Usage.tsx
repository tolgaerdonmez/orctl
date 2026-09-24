import { useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import type { Column } from "../../core/format/columns.ts";
import { formatUsd } from "../../core/format/money.ts";
import { plainStyle } from "../../core/format/view.ts";
import { activityColumns, keyUsageColumns, spendBar, usageFooter } from "../../core/format/views-usage.ts";
import type { KeyUsageRow, UsageBy, UsageReport, UsageRow } from "../../core/ops/usage.ts";
import { DataTable, listKeys } from "../components/DataTable.tsx";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";

const TABS: Array<{ by: UsageBy; title: string }> = [
  { by: "model", title: "Model" },
  { by: "provider", title: "Provider" },
  { by: "day", title: "Day" },
  { by: "workspace", title: "Workspace" },
  { by: "key", title: "Key" },
];
const WINDOWS = [1, 7, 14, 30] as const;

/** Usage (plan §7.3): breakdown tabs (tab), date window ([ and ]), table with spend bars. */
export function UsageScreen() {
  const dims = useTerminalDimensions();
  const [tab, setTab] = useState(0);
  const [win, setWin] = useState(3);
  const [selected, setSelected] = useState(0);
  const by = TABS[tab]?.by ?? "model";
  const days = WINDOWS[win] ?? 30;
  const input = { by, ...(by === "key" || days === 30 ? {} : { days }) };
  const report = useOp<UsageReport>("usage.report", input);
  useCliHint("usage.report", by === "model" ? (days === 30 ? {} : { days }) : input);
  const rows = (report.data?.rows ?? []) as Array<UsageRow | KeyUsageRow>;

  useKeys((id) => {
    if (listKeys(id, rows.length, selected, setSelected)) return true;
    if (id === "tab") {
      setTab((t) => (t + 1) % TABS.length);
      setSelected(0);
      return true;
    }
    if (id === "[" || id === "]") {
      setWin((w) => Math.max(0, Math.min(WINDOWS.length - 1, w + (id === "]" ? 1 : -1))));
      return true;
    }
    return false;
  });

  const columns = (by === "key" ? keyUsageColumns : activityColumns(by)) as Column<UsageRow | KeyUsageRow>[];
  return (
    <Panel title="Usage">
      <text>
        {TABS.map((t, i) => (
          <span
            key={t.by}
            fg={i === tab ? theme.selectionFg : theme.muted}
            bg={i === tab ? theme.selectionBg : undefined}
          >
            {` ${t.title} `}
          </span>
        ))}
        <span
          fg={theme.dim}
        >{`   window: ${by === "key" ? "counters" : `last ${days} day${days === 1 ? "" : "s"}`} ([ ])   tab breakdown`}</span>
      </text>
      {report.isLoading ? <text fg={theme.muted}>Loading usage…</text> : null}
      {report.error ? <text fg={theme.bad}>{`✖ ${report.error.message}`}</text> : null}
      <DataTable
        columns={columns}
        rows={rows}
        selected={selected}
        width={Math.max(40, dims.width - 6)}
        height={Math.max(4, dims.height - 11)}
        empty={report.data ? "No usage in this window." : ""}
        rowKey={(r) => r.group}
      />
      {report.data
        ? usageFooter(report.data, plainStyle).map((l) => (
            <text key={l} fg={l.startsWith("Total") ? theme.fg : theme.dim}>
              {l}
            </text>
          ))
        : null}
    </Panel>
  );
}

/** Dashboard card (plan §7.3): the five models with the most spend over the last 7 days. */
export function TopModelsCard() {
  const tui = useTui();
  const enabled = Boolean(tui.profile?.managementRef);
  const report = useOp<UsageReport>("usage.report", { by: "model", days: 7 }, { enabled });
  if (!enabled) return null;
  const rows = ((report.data?.rows ?? []) as UsageRow[]).slice(0, 5);
  return (
    <Panel title="Top models, last 7 days">
      {report.error ? <text fg={theme.bad}>{`✖ ${report.error.message}`}</text> : null}
      {report.data && rows.length === 0 ? <text fg={theme.muted}>No usage.</text> : null}
      {rows.map((r) => (
        <text key={r.group}>
          <span fg={theme.fg}>{`${r.group.padEnd(34).slice(0, 34)} ${formatUsd(r.usage).padStart(9)} `}</span>
          <span fg={theme.accent}>{spendBar(r.share, 16)}</span>
        </text>
      ))}
    </Panel>
  );
}
