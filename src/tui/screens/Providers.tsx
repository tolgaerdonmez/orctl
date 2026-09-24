import { useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import { plainStyle } from "../../core/format/view.ts";
import { modelViews, providerColumns } from "../../core/format/views-models.ts";
import type { ProviderItem } from "../../core/ops/providers.ts";
import { DataTable, listKeys } from "../components/DataTable.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys } from "../state.tsx";
import { theme } from "../theme.ts";

/** Providers (plan §7.3): table with instant filter; the right panel is providers.show. */
export function ProvidersScreen() {
  const dims = useTerminalDimensions();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const list = useOp<{ providers: ProviderItem[] }>("providers.list", {});
  const q = query.toLowerCase();
  const rows = (list.data?.providers ?? []).filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.slug.includes(q),
  );
  const current = rows[Math.min(selected, Math.max(0, rows.length - 1))];
  useCliHint(
    current ? "providers.show" : "providers.list",
    current ? { slug: current.slug } : query ? { q: query } : {},
  );
  useKeys(
    (id) => {
      if (listKeys(id, rows.length, selected, setSelected)) return true;
      if (id === "/") {
        setSearching(true);
        return true;
      }
      return false;
    },
    undefined,
    !searching,
  );
  const view = modelViews["providers.show"];
  return (
    <box flexDirection="row" flexGrow={1}>
      <Panel title="Providers" width="55%">
        <FilterBar
          active={searching}
          query={query}
          placeholder="search providers"
          onChange={(v) => {
            setQuery(v);
            setSelected(0);
          }}
          onDone={() => setSearching(false)}
        />
        {list.isLoading ? <text fg={theme.muted}>Loading…</text> : null}
        {list.error ? <text fg={theme.bad}>{`✖ ${list.error.message}`}</text> : null}
        <DataTable
          columns={providerColumns.slice(0, 3)}
          rows={rows}
          selected={selected}
          width={Math.max(30, Math.floor(dims.width * 0.55) - 4)}
          height={Math.max(4, dims.height - 8)}
          empty="No providers match."
          rowKey={(p) => p.slug}
        />
      </Panel>
      <Panel title={current?.name ?? "Provider"}>
        {current && view?.kind === "lines"
          ? view.lines(current, plainStyle, new Date()).map((l: string) => (
              <text key={l} fg={theme.fg}>
                {l}
              </text>
            ))
          : null}
      </Panel>
    </box>
  );
}
