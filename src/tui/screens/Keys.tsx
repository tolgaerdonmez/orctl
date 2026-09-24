import { useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import { plainStyle } from "../../core/format/view.ts";
import { keyColumns, keyDetailLines } from "../../core/format/views-keys.ts";
import type { KeyItem } from "../../core/ops/keys.ts";
import { DataTable, listKeys } from "../components/DataTable.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";
import { keyAction } from "./key-actions.tsx";

export type KeysResult = { keys: KeyItem[]; workspaces: number; partial: string[] };

/**
 * Keys (plan §7.3, §8.2): every workspace is listed; `tab` filters by workspace client-side so it
 * is instant, `x` toggles disabled keys, `/` filters by name or label. The right panel shows the
 * selected key; n/e/space/D act on it (key-actions.tsx).
 */
export function KeysScreen() {
  const tui = useTui();
  const dims = useTerminalDimensions();
  const [showDisabled, setShowDisabled] = useState(false);
  const [wsIndex, setWsIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const list = useOp<KeysResult>("keys.list", showDisabled ? { includeDisabled: true } : {});
  const all = list.data?.keys ?? [];
  const workspaces = ["all", ...Array.from(new Set(all.map((k) => k.workspaceSlug))).sort()];
  const ws = workspaces[wsIndex % workspaces.length] ?? "all";
  const q = query.toLowerCase();
  const rows = all.filter(
    (k) =>
      (ws === "all" || k.workspaceSlug === ws) &&
      (!q || k.name.toLowerCase().includes(q) || k.label.includes(q)),
  );
  const current = rows[Math.min(selected, Math.max(0, rows.length - 1))];
  const now = tui.ctx?.clock.now() ?? new Date();
  useCliHint("keys.list", {
    ...(ws !== "all" ? { workspace: ws } : {}),
    ...(showDisabled ? { includeDisabled: true } : {}),
  });

  useKeys(
    (id) => {
      if (keyAction(tui, id, current)) return true;
      if (listKeys(id, rows.length, selected, setSelected)) return true;
      switch (id) {
        case "/":
          setSearching(true);
          return true;
        case "tab":
          setWsIndex((i) => (i + 1) % workspaces.length);
          setSelected(0);
          return true;
        case "x":
          setShowDisabled((v) => !v);
          return true;
        case "enter":
          if (current)
            tui.push({ id: "key-detail", params: { hash: current.hash, workspace: current.workspaceSlug } });
          return true;
        default:
          return false;
      }
    },
    undefined,
    !searching,
  );

  const tableWidth = Math.max(40, Math.floor(dims.width * 0.62) - 4);
  return (
    <box flexDirection="row" flexGrow={1}>
      <Panel title="Keys" width="64%">
        <FilterBar
          active={searching}
          query={query}
          placeholder="filter by name or label"
          onChange={(v) => {
            setQuery(v);
            setSelected(0);
          }}
          onDone={() => setSearching(false)}
          right={`workspace: ${ws} (tab) · disabled: ${showDisabled ? "shown" : "hidden"} (x)`}
        />
        {list.isLoading ? <text fg={theme.muted}>Loading keys from every workspace…</text> : null}
        {list.error ? <text fg={theme.bad}>{`✖ ${list.error.message}`}</text> : null}
        {list.data?.partial.length ? (
          <text fg={theme.warn}>{`! missing workspaces: ${list.data.partial.join(", ")}`}</text>
        ) : null}
        <DataTable
          columns={keyColumns(now).filter((c) =>
            ["name", "label", "workspace", "limit", "usage", "expires", "status"].includes(c.id),
          )}
          rows={rows}
          selected={selected}
          width={tableWidth}
          height={Math.max(4, dims.height - 10)}
          empty={list.data ? "No keys here." : ""}
          rowKey={(k) => k.hash}
        />
        <text fg={theme.dim}>
          n new · e edit · space enable/disable · r rotate · D delete · enter details
        </text>
      </Panel>
      <Panel title={current?.name ?? "Key"}>
        {current
          ? keyDetailLines(current, plainStyle, now).map((l) => (
              <text key={l} fg={theme.fg}>
                {l}
              </text>
            ))
          : null}
      </Panel>
    </box>
  );
}

/** Full-screen key detail (enter from Keys). */
export function KeyDetailScreen(props: { hash: string; workspace?: string }) {
  const tui = useTui();
  const key = useOp<KeyItem>("keys.show", { ref: props.hash });
  useCliHint("keys.show", { ref: props.hash.slice(0, 12) });
  useKeys((id) => (id === "n" ? false : keyAction(tui, id, key.data)));
  const now = tui.ctx?.clock.now() ?? new Date();
  return (
    <Panel title={key.data ? `Key ${key.data.name}` : "Key"}>
      {key.isLoading ? <text fg={theme.muted}>Loading…</text> : null}
      {key.error ? <text fg={theme.bad}>{`✖ ${key.error.message}`}</text> : null}
      {key.data
        ? keyDetailLines(key.data, plainStyle, now).map((l) => (
            <text key={l} fg={theme.fg}>
              {l}
            </text>
          ))
        : null}
      <text fg={theme.dim} marginTop={1}>
        e edit · space enable/disable · r rotate · D delete · esc back
      </text>
    </Panel>
  );
}
