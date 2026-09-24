import { useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import { plainStyle } from "../../core/format/view.ts";
import { endpointColumns, modelOverviewLines, pricingLines } from "../../core/format/views-models.ts";
import type { EndpointItem, ModelItem } from "../../core/ops/models.ts";
import { DataTable, listKeys } from "../components/DataTable.tsx";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys } from "../state.tsx";
import { theme } from "../theme.ts";

const TABS = ["Overview", "Pricing", "Endpoints"] as const;
const SORTS = [undefined, "price", "uptime", "latency", "throughput"] as const;

/** ModelDetail (plan §7.3): Overview | Pricing | Endpoints (tab / ←→ switch). */
export function ModelDetailScreen(props: { id: string }) {
  const dims = useTerminalDimensions();
  const [tab, setTab] = useState(0);
  const [sort, setSort] = useState<(typeof SORTS)[number]>(undefined);
  const [selected, setSelected] = useState(0);
  const model = useOp<ModelItem>("models.show", { id: props.id });
  const endpoints = useOp<{ endpoints: EndpointItem[] }>(
    "models.endpoints",
    { id: props.id, ...(sort ? { sort } : {}) },
    { enabled: tab === 2 },
  );
  useCliHint(
    tab === 2 ? "models.endpoints" : "models.show",
    tab === 2 ? { id: props.id, sort } : { id: props.id },
  );
  const rows = endpoints.data?.endpoints ?? [];

  useKeys((id) => {
    if (id === "tab" || id === "right" || id === "l") {
      setTab((t) => (t + 1) % TABS.length);
      return true;
    }
    if (id === "left" || id === "h") {
      setTab((t) => (t - 1 + TABS.length) % TABS.length);
      return true;
    }
    if (tab === 2) {
      if (listKeys(id, rows.length, selected, setSelected)) return true;
      if (id === "s") {
        setSort((s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]);
        return true;
      }
    }
    return false;
  });

  const m = model.data;
  const overviewOnly = m
    ? [...modelOverviewLines(m, plainStyle), ...(m.description ? ["", m.description] : [])]
    : [];
  return (
    <Panel title={m ? m.name : props.id}>
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
        <span fg={theme.dim}>{"   tab/←→ switch · esc back"}</span>
      </text>
      {model.isLoading ? <text fg={theme.muted}>Loading…</text> : null}
      {model.error ? <text fg={theme.bad}>{`✖ ${model.error.message}`}</text> : null}
      {m && tab === 0
        ? overviewOnly.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static line list.
            <text key={i} fg={theme.fg}>
              {l}
            </text>
          ))
        : null}
      {m && tab === 1
        ? pricingLines(m.pricing, plainStyle).map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static line list.
            <text key={i} fg={l.startsWith("⚑") ? theme.warn : theme.fg}>
              {l}
            </text>
          ))
        : null}
      {tab === 2 ? (
        <>
          <text fg={theme.muted}>{`sort: ${sort ?? "provider order"} (s)`}</text>
          {endpoints.isLoading ? <text fg={theme.muted}>Loading endpoints…</text> : null}
          {endpoints.error ? <text fg={theme.bad}>{`✖ ${endpoints.error.message}`}</text> : null}
          <DataTable
            columns={endpointColumns}
            rows={rows}
            selected={selected}
            width={Math.max(40, dims.width - 6)}
            height={Math.max(4, dims.height - 9)}
            empty="No endpoints."
            rowKey={(e) => `${e.provider}-${e.tag}`}
          />
        </>
      ) : null}
    </Panel>
  );
}
