import type { EndpointItem, ModelItem } from "../ops/models.ts";
import type { ProviderItem } from "../ops/providers.ts";
import { formatPrice } from "../pricing/decimal.ts";
import { formatPerMillion, normalizePricing, pricingFlags } from "../pricing/normalize.ts";
import type { Column } from "./columns.ts";
import { formatDay, relativeTime } from "./time.ts";
import { kv, lines, type Style, table, type View } from "./view.ts";

/** 1048576 → "1.05M", 128000 → "128K". */
export function formatContext(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const bench = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toFixed(1));

export const modelColumns: Column<ModelItem>[] = [
  { id: "id", header: "ID", value: (m) => m.id, priority: 0 },
  { id: "name", header: "NAME", value: (m) => m.name, priority: 4 },
  {
    id: "in",
    header: "IN $/M",
    value: (m) => formatPerMillion(normalizePricing(m.pricing).input).replace("/M", ""),
    align: "right",
    priority: 1,
  },
  {
    id: "out",
    header: "OUT $/M",
    value: (m) => formatPerMillion(normalizePricing(m.pricing).output).replace("/M", ""),
    align: "right",
    priority: 1,
  },
  {
    id: "cache",
    header: "CACHE $/M",
    value: (m) => formatPerMillion(normalizePricing(m.pricing).cacheRead).replace("/M", ""),
    align: "right",
    priority: 3,
  },
  {
    id: "context",
    header: "CONTEXT",
    value: (m) => formatContext(m.contextLength),
    align: "right",
    priority: 2,
  },
  {
    id: "flags",
    header: "",
    value: (m) => pricingFlags(normalizePricing(m.pricing)),
    priority: 2,
    tone: (m) => {
      const n = normalizePricing(m.pricing);
      return n.free ? "good" : n.variable ? "muted" : n.tiered ? "warn" : undefined;
    },
  },
  { id: "modality", header: "MODALITY", value: (m) => m.modality ?? "", priority: 5, optional: true },
  { id: "created", header: "CREATED", value: (m) => formatDay(m.created), priority: 5, optional: true },
  { id: "author", header: "AUTHOR", value: (m) => m.author, priority: 5, optional: true },
  {
    id: "intelligence",
    header: "INTEL",
    value: (m) => bench(m.benchmarks?.intelligence),
    align: "right",
    priority: 5,
    optional: true,
  },
  {
    id: "coding",
    header: "CODING",
    value: (m) => bench(m.benchmarks?.coding),
    align: "right",
    priority: 5,
    optional: true,
  },
  {
    id: "agentic",
    header: "AGENTIC",
    value: (m) => bench(m.benchmarks?.agentic),
    align: "right",
    priority: 5,
    optional: true,
  },
];

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

export const endpointColumns: Column<EndpointItem>[] = [
  { id: "provider", header: "PROVIDER", value: (e) => e.provider, priority: 0 },
  { id: "tag", header: "TAG", value: (e) => e.tag, priority: 1 },
  {
    id: "in",
    header: "IN $/M",
    value: (e) => formatPerMillion(normalizePricing(e.pricing).input).replace("/M", ""),
    align: "right",
    priority: 0,
  },
  {
    id: "out",
    header: "OUT $/M",
    value: (e) => formatPerMillion(normalizePricing(e.pricing).output).replace("/M", ""),
    align: "right",
    priority: 0,
  },
  {
    id: "discount",
    header: "DISC",
    value: (e) => (e.pricing.discount ? `-${Math.round(Number(e.pricing.discount) * 100)}%` : ""),
    align: "right",
    priority: 2,
    tone: () => "good",
  },
  {
    id: "context",
    header: "CONTEXT",
    value: (e) => formatContext(e.contextLength),
    align: "right",
    priority: 2,
  },
  {
    id: "uptime",
    header: "UPTIME 30M",
    value: (e) => pct(e.uptime30m),
    align: "right",
    priority: 1,
    tone: (e) =>
      e.uptime30m === null ? undefined : e.uptime30m >= 99 ? "good" : e.uptime30m >= 90 ? "warn" : "bad",
  },
  {
    id: "latency",
    header: "LATENCY",
    value: (e) => (e.latencyP50 === null ? "—" : `${Math.round(e.latencyP50)}ms`),
    align: "right",
    priority: 2,
  },
  {
    id: "throughput",
    header: "TOK/S",
    value: (e) => (e.throughputP50 === null ? "—" : e.throughputP50.toFixed(0)),
    align: "right",
    priority: 2,
  },
  { id: "quant", header: "QUANT", value: (e) => e.quantization ?? "", priority: 3 },
  {
    id: "status",
    header: "STATUS",
    value: (e) => (e.status === null ? "" : e.status === 0 ? "ok" : `degraded (${e.status})`),
    priority: 3,
    tone: (e) => (e.status && e.status < 0 ? "warn" : undefined),
  },
];

export const providerColumns: Column<ProviderItem>[] = [
  { id: "name", header: "NAME", value: (p) => p.name, priority: 0 },
  { id: "slug", header: "SLUG", value: (p) => p.slug, priority: 1 },
  { id: "hq", header: "HQ", value: (p) => p.headquarters ?? "", priority: 2 },
  { id: "datacenters", header: "DATACENTERS", value: (p) => p.datacenters.join(","), priority: 3 },
  { id: "status", header: "STATUS PAGE", value: (p) => p.statusPageUrl ?? "", priority: 4 },
];

/** Full pricing breakdown lines for a model or endpoint (plan §8.3). */
export function pricingLines(pricing: ModelItem["pricing"], s: Style): string[] {
  const n = normalizePricing(pricing);
  if (n.variable) return [s.dim("Variable: the price depends on the model the router picks.")];
  const rows: Array<[string, string]> = n.perToken.map((f) => [f.label, formatPerMillion(f.perMillion)]);
  for (const f of n.perUnit)
    rows.push([f.label, `${formatPrice(f.price, { free: "free" })}/${f.label.split(" ").pop()}`]);
  if (n.discount) rows.push(["discount", `-${Math.round(n.discount * 100)}% (applied above)`]);
  const out = kv(rows, s);
  if (n.free) out.unshift(s.tone("good", "FREE"));
  for (const t of n.tiers) {
    const parts = t.prices.map((p) => `${p.label} ${formatPerMillion(p.perMillion)}`).join(" · ");
    out.push(s.tone("warn", `⚑ ${t.condition}: ${parts}`));
  }
  return out;
}

/** Identity, context, modality, reasoning, benchmarks and parameters of a model. */
export function modelOverviewLines(m: ModelItem, s: Style): string[] {
  const rows: Array<[string, string]> = [
    ["Model", `${s.bold(m.name)} (${m.id})`],
    [
      "Context",
      `${formatContext(m.contextLength)} tokens${m.maxCompletionTokens ? ` · max output ${formatContext(m.maxCompletionTokens)}` : ""}`,
    ],
    ["Modality", m.modality ?? `${m.inputModalities.join("+")}->${m.outputModalities.join("+")}`],
    ["Created", formatDay(m.created)],
  ];
  if (m.knowledgeCutoff) rows.push(["Knowledge", m.knowledgeCutoff]);
  if (m.expirationDate) rows.push(["Expires", m.expirationDate]);
  if (m.reasoning) {
    const r = m.reasoning;
    const mode = r.mandatory ? "mandatory" : r.defaultEnabled ? "on by default" : "optional";
    const efforts = r.supportedEfforts?.filter(Boolean).join("/");
    rows.push(["Reasoning", `${mode}${efforts ? ` · efforts ${efforts}` : ""}`]);
  }
  if (m.benchmarks) {
    const b = m.benchmarks;
    rows.push([
      "Benchmarks",
      `intelligence ${bench(b.intelligence) || "—"} · coding ${bench(b.coding) || "—"} · agentic ${bench(b.agentic) || "—"}`,
    ]);
  }
  rows.push(["Parameters", m.supportedParameters.join(", ") || "—"]);
  return kv(rows, s);
}

export const modelViews: Record<string, View> = {
  "models.list": table<{ models: ModelItem[]; count: number; fetchedAt: string | null }, ModelItem>({
    rows: (o) => o.models,
    columns: modelColumns,
    empty: "No models match.",
    footer: (o, s, now) => [
      s.dim(
        `${o.count} model${o.count === 1 ? "" : "s"} · USD per million tokens · ⚑ tiered pricing${o.fetchedAt ? ` · fetched ${relativeTime(o.fetchedAt, now)}` : ""}`,
      ),
    ],
  }),
  "models.show": lines<ModelItem>((m, s) => [
    ...modelOverviewLines(m, s),
    "",
    s.bold("Pricing"),
    ...pricingLines(m.pricing, s),
    ...(m.description ? ["", s.dim(m.description)] : []),
  ]),
  "models.endpoints": table<{ model: { id: string; name: string }; endpoints: EndpointItem[] }, EndpointItem>(
    {
      rows: (o) => o.endpoints,
      columns: endpointColumns,
      empty: "No endpoints serve this model right now.",
      header: (o, s) => [s.bold(`${o.model.name} (${o.model.id})`)],
    },
  ),
  "providers.list": table<{ providers: ProviderItem[]; count: number }, ProviderItem>({
    rows: (o) => o.providers,
    columns: providerColumns,
    empty: "No providers match.",
    footer: (o, s) => [s.dim(`${o.count} providers`)],
  }),
  "providers.show": lines<ProviderItem>((p, s) =>
    kv(
      [
        ["Provider", `${s.bold(p.name)} (${p.slug})`],
        ["Headquarters", p.headquarters ?? "—"],
        ["Datacenters", p.datacenters.join(", ") || "—"],
        ["Privacy", p.privacyPolicyUrl ?? "—"],
        ["Terms", p.termsOfServiceUrl ?? "—"],
        ["Status", p.statusPageUrl ?? "—"],
      ],
      s,
    ),
  ),
};
