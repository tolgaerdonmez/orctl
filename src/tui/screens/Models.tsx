import { useTerminalDimensions } from "@opentui/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { OrctlError } from "../../core/errors.ts";
import { relativeTime } from "../../core/format/time.ts";
import { modelColumns } from "../../core/format/views-models.ts";
import { filterModels, type ModelItem, type ModelsListInput, needsServer } from "../../core/ops/models.ts";
import { DataTable, listKeys } from "../components/DataTable.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { ChoiceList, TextField } from "../components/fields.tsx";
import { MODAL_CONTENT, Modal } from "../components/Modal.tsx";
import { Panel } from "../components/Shell.tsx";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";

type ListResult = { models: ModelItem[]; count: number; fetchedAt: string | null };

const SORT_CYCLE = [undefined, "price", "price-desc", "output-price", "context", "newest", "name"] as const;

export function describeFilters(f: ModelsListInput): string {
  const parts: string[] = [];
  if (f.sort) parts.push(`sort ${f.sort}`);
  if (f.maxPrice !== undefined) parts.push(`in ≤ $${f.maxPrice}/M`);
  if (f.maxOutputPrice !== undefined) parts.push(`out ≤ $${f.maxOutputPrice}/M`);
  if (f.minContext) parts.push(`ctx ≥ ${f.minContext}`);
  if (f.modality) parts.push(f.modality);
  if (f.author) parts.push(`by ${f.author}`);
  if (f.free) parts.push("free");
  if (f.param) parts.push(f.param);
  if (f.zdr) parts.push("zdr");
  if (f.region) parts.push(`region ${f.region}`);
  if (f.provider) parts.push(`via ${f.provider}`);
  return parts.join(" · ");
}

/**
 * Models (plan §7.3): instant search over the cached full list, filter chips, sort, and the
 * fetched-at age. The cached copy renders immediately while a fresh one loads
 * (stale-while-revalidate, plan §8.4).
 */
export function ModelsScreen() {
  const tui = useTui();
  const dims = useTerminalDimensions();
  const profile = tui.ctx?.profile?.name ?? "(none)";
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [filters, setFilters] = useState<ModelsListInput>({});
  const [selected, setSelected] = useState(0);
  const server = needsServer(filters);

  const cached = useQuery<ListResult | null, OrctlError>({
    queryKey: [profile, "models.list", "offline"],
    queryFn: () => tui.runOp<ListResult>("models.list", {}, { cachePolicy: "offline" }).catch(() => null),
    enabled: Boolean(tui.ctx),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const live = useQuery<ListResult, OrctlError>({
    queryKey: [profile, "models.list", {}],
    queryFn: () => tui.runOp<ListResult>("models.list", {}),
    enabled: Boolean(tui.ctx) && !server,
  });
  const remote = useQuery<ListResult, OrctlError>({
    queryKey: [profile, "models.list", filters],
    queryFn: () => tui.runOp<ListResult>("models.list", filters),
    enabled: Boolean(tui.ctx) && server,
  });

  const source = server ? remote.data : (live.data ?? cached.data ?? undefined);
  const effective: ModelsListInput = useMemo(() => ({ ...filters, q: query || undefined }), [filters, query]);
  const rows = useMemo(() => {
    if (!source) return [];
    // server results are already filtered; only the instant search applies on top
    return filterModels(source.models, server ? { q: effective.q } : effective);
  }, [source, server, effective]);
  const current = rows[Math.min(selected, Math.max(0, rows.length - 1))];
  useCliHint("models.list", effective as Record<string, unknown>);

  useKeys(
    (id) => {
      if (listKeys(id, rows.length, selected, setSelected, Math.max(5, dims.height - 12))) return true;
      switch (id) {
        case "/":
          setSearching(true);
          return true;
        case "s": {
          const i = SORT_CYCLE.indexOf(filters.sort as (typeof SORT_CYCLE)[number]);
          const next = SORT_CYCLE[(i + 1) % SORT_CYCLE.length];
          setFilters({ ...filters, sort: next });
          return true;
        }
        case "f":
          tui.openModal(<ModelFilters initial={filters} onApply={(f) => setFilters(f)} />);
          return true;
        case "x":
          setFilters({});
          setQuery("");
          return true;
        case "enter":
          if (current) tui.push({ id: "model-detail", params: { id: current.id } });
          return true;
        default:
          return false;
      }
    },
    undefined,
    !searching,
  );

  const loading = !source && (live.isLoading || cached.isLoading || remote.isLoading);
  const error = server ? remote.error : live.error && !cached.data ? live.error : null;
  const age = source?.fetchedAt ? relativeTime(source.fetchedAt, tui.ctx?.clock.now() ?? new Date()) : null;
  const refreshing = !server && live.isFetching && Boolean(cached.data);
  const status = `${rows.length} of ${source?.count ?? 0} · $/M${age ? ` · fetched ${age}` : ""}${refreshing ? " · refreshing…" : ""}`;
  return (
    <Panel title="Models">
      <FilterBar
        active={searching}
        query={query}
        placeholder="search models (id or name)"
        onChange={(q) => {
          setQuery(q);
          setSelected(0);
        }}
        onDone={() => setSearching(false)}
        right={status}
      />
      <text fg={theme.accent}>{describeFilters(filters) || " "}</text>
      {loading ? <text fg={theme.muted}>Loading models…</text> : null}
      {error ? <text fg={theme.bad}>{`✖ ${error.message}`}</text> : null}
      <DataTable
        columns={modelColumns}
        rows={rows}
        selected={selected}
        width={Math.max(40, dims.width - 6)}
        height={Math.max(4, dims.height - 10)}
        empty={source ? "No models match." : ""}
        rowKey={(m) => m.id}
      />
      <text fg={theme.dim}>/ search · f filters · s sort · x clear · enter details</text>
    </Panel>
  );
}

type FilterField =
  | "maxPrice"
  | "maxOutputPrice"
  | "minContext"
  | "modality"
  | "author"
  | "param"
  | "provider";

const FIELDS: Array<{ field: FilterField; label: string; numeric?: boolean }> = [
  { field: "maxPrice", label: "Max input $/M", numeric: true },
  { field: "maxOutputPrice", label: "Max output $/M", numeric: true },
  { field: "minContext", label: "Min context", numeric: true },
  { field: "modality", label: "Modality" },
  { field: "author", label: "Author" },
  { field: "param", label: "Parameters" },
  { field: "provider", label: "Provider (server)" },
];

/** Filter form (plan §7.3 filter chips): the same fields as `orctl models list` flags. */
function ModelFilters(props: { initial: ModelsListInput; onApply(f: ModelsListInput): void }) {
  const tui = useTui();
  const [draft, setDraft] = useState<ModelsListInput>(props.initial);
  const [row, setRow] = useState(0);
  const toggles = [
    { key: "free", label: "Free only" },
    { key: "zdr", label: "Zero data retention (server)" },
  ] as const;
  const total = FIELDS.length + toggles.length + 1;
  useKeys((id) => {
    if (id === "up" || id === "shift+tab") {
      setRow((r) => (r - 1 + total) % total);
      return true;
    }
    if (id === "down" || id === "tab") {
      setRow((r) => (r + 1) % total);
      return true;
    }
    if (id === "space" || id === "enter") {
      const t = toggles[row - FIELDS.length];
      if (t) {
        setDraft((d) => ({ ...d, [t.key]: d[t.key] ? undefined : true }));
        return true;
      }
      if (row === total - 1) {
        tui.closeModal();
        props.onApply(draft);
        return true;
      }
    }
    return false;
  }, MODAL_CONTENT + 1);
  return (
    <Modal
      title="Model filters"
      onClose={tui.closeModal}
      height={FIELDS.length + toggles.length + 6}
      width={64}
    >
      {FIELDS.map((f, i) => (
        <TextField
          key={f.field}
          focused={row === i}
          priority={MODAL_CONTENT}
          label={f.label.padEnd(18)}
          initial={draft[f.field] === undefined ? "" : String(draft[f.field])}
          width={30}
          onEscape={tui.closeModal}
          onChange={(v) => {
            const value = v.trim() === "" ? undefined : f.numeric ? Number(v) : v.trim();
            if (f.numeric && value !== undefined && !Number.isFinite(value)) return;
            setDraft((d) => ({ ...d, [f.field]: value }));
          }}
          onSubmit={() => setRow((r) => r + 1)}
        />
      ))}
      <ChoiceList
        focused={false}
        options={toggles.map((t) => ({ value: t.key, label: `[${draft[t.key] ? "x" : " "}] ${t.label}` }))}
        selected={row - FIELDS.length}
        onMove={() => {}}
        onChoose={() => {}}
      />
      <text
        fg={row === total - 1 ? theme.selectionFg : theme.accent}
        bg={row === total - 1 ? theme.selectionBg : undefined}
      >
        {"  Apply  "}
      </text>
      <text fg={theme.dim}>↑↓ move · space toggle · enter apply · esc cancel</text>
    </Modal>
  );
}
