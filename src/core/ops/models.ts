import { createHash } from "node:crypto";
import type { Model, PublicEndpoint } from "@openrouter/sdk/models";
import { z } from "zod";
import { TTL } from "../cache/disk-cache.ts";
import { OrctlError, usageError } from "../errors.ts";
import { nearMatches } from "../format/suggest.ts";
import { comparePrices, type Price, parseUserAmount } from "../pricing/decimal.ts";
import {
  type NormalizedPricing,
  normalizePricing,
  type PricingLike,
  pricingJson,
} from "../pricing/normalize.ts";
import { type Ctx, defineOp } from "./types.ts";

/**
 * Public model catalog (plan §8.3, §8.4). The full list (one call, ~750 KB) is cached for 10
 * minutes and filtered locally; filters that need server data (zdr, region, provider, and the
 * popularity/performance/benchmark sorts) go to the API with those parameters.
 */

export const LOCAL_SORTS = ["price", "price-desc", "output-price", "context", "newest", "name"] as const;
const SERVER_SORTS = {
  popular: "most-popular",
  "top-weekly": "top-weekly",
  throughput: "throughput-high-to-low",
  latency: "latency-low-to-high",
  intelligence: "intelligence-high-to-low",
  coding: "coding-high-to-low",
  agentic: "agentic-high-to-low",
} as const;
export const MODEL_SORTS = [...LOCAL_SORTS, ...Object.keys(SERVER_SORTS)] as readonly string[];

export interface ModelItem {
  id: string;
  name: string;
  author: string;
  canonicalSlug: string;
  created: number;
  contextLength: number | null;
  modality: string | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  pricing: PricingLike;
  price: ReturnType<typeof pricingJson>;
  benchmarks: { intelligence: number | null; coding: number | null; agentic: number | null } | null;
  description?: string | undefined;
  knowledgeCutoff?: string | null | undefined;
  expirationDate?: string | null | undefined;
  maxCompletionTokens?: number | null | undefined;
  reasoning?: Model["reasoning"];
}

export function toItem(m: Model, withDetail = false): ModelItem {
  const pricing = m.pricing as unknown as PricingLike;
  const aa = m.benchmarks?.artificialAnalysis as
    | { intelligenceIndex?: number | null; codingIndex?: number | null; agenticIndex?: number | null }
    | undefined;
  const item: ModelItem = {
    id: m.id,
    name: m.name,
    author: m.id.split("/")[0] ?? "",
    canonicalSlug: m.canonicalSlug,
    created: m.created,
    contextLength: m.contextLength,
    modality: m.architecture.modality,
    inputModalities: [...m.architecture.inputModalities],
    outputModalities: [...m.architecture.outputModalities],
    supportedParameters: [...m.supportedParameters],
    pricing,
    price: pricingJson(normalizePricing(pricing)),
    benchmarks: aa
      ? {
          intelligence: aa.intelligenceIndex ?? null,
          coding: aa.codingIndex ?? null,
          agentic: aa.agenticIndex ?? null,
        }
      : null,
  };
  if (withDetail) {
    item.description = m.description;
    item.knowledgeCutoff = m.knowledgeCutoff;
    item.expirationDate = m.expirationDate;
    item.maxCompletionTokens = m.topProvider?.maxCompletionTokens;
    item.reasoning = m.reasoning;
  }
  return item;
}

export const ModelsListInput = z.object({
  q: z.string().optional(),
  sort: z.enum(MODEL_SORTS as [string, ...string[]]).optional(),
  maxPrice: z.number().nonnegative().optional(),
  minPrice: z.number().nonnegative().optional(),
  maxOutputPrice: z.number().nonnegative().optional(),
  minContext: z.number().int().positive().optional(),
  modality: z.string().optional(),
  author: z.string().optional(),
  free: z.boolean().optional(),
  param: z.string().optional(),
  zdr: z.boolean().optional(),
  region: z.enum(["eu", "us"]).optional(),
  provider: z.string().optional(),
  limit: z.number().int().positive().optional(),
});
export type ModelsListInput = z.infer<typeof ModelsListInput>;

export function needsServer(input: ModelsListInput): boolean {
  return Boolean(input.zdr || input.region || input.provider || (input.sort && input.sort in SERVER_SORTS));
}

const priceOk = (p: Price, limit: Price, cmp: (c: number) => boolean) =>
  p.kind === "value" && cmp(comparePrices(p, limit));

/** Local filtering and sorting shared by the CLI and the TUI's instant search. */
export function filterModels(items: readonly ModelItem[], input: ModelsListInput): ModelItem[] {
  const terms = (input.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const params = (input.param ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const maxIn = input.maxPrice === undefined ? undefined : parseUserAmount(input.maxPrice);
  const minIn = input.minPrice === undefined ? undefined : parseUserAmount(input.minPrice);
  const maxOut = input.maxOutputPrice === undefined ? undefined : parseUserAmount(input.maxOutputPrice);
  const norm = new Map<string, NormalizedPricing>();
  const n = (m: ModelItem) => {
    let v = norm.get(m.id);
    if (!v) {
      v = normalizePricing(m.pricing);
      norm.set(m.id, v);
    }
    return v;
  };
  let out = items.filter((m) => {
    const hay = `${m.id} ${m.name}`.toLowerCase();
    if (terms.some((t) => !hay.includes(t))) return false;
    if (input.author && m.author !== input.author.toLowerCase()) return false;
    if (input.free && !n(m).free) return false;
    if (input.minContext && (m.contextLength ?? 0) < input.minContext) return false;
    if (
      input.modality &&
      !m.inputModalities.includes(input.modality) &&
      !m.outputModalities.includes(input.modality)
    )
      return false;
    if (params.some((p) => !m.supportedParameters.includes(p))) return false;
    if (maxIn && !priceOk(n(m).input, maxIn, (c) => c <= 0)) return false;
    if (minIn && !priceOk(n(m).input, minIn, (c) => c >= 0)) return false;
    if (maxOut && !priceOk(n(m).output, maxOut, (c) => c <= 0)) return false;
    return true;
  });
  const sort = input.sort;
  if (sort && (LOCAL_SORTS as readonly string[]).includes(sort)) {
    const byName = (a: ModelItem, b: ModelItem) => a.name.localeCompare(b.name);
    const cmp: Record<string, (a: ModelItem, b: ModelItem) => number> = {
      price: (a, b) => comparePrices(n(a).input, n(b).input) || byName(a, b),
      "price-desc": (a, b) => {
        const va = n(a).input;
        const vb = n(b).input;
        if (va.kind !== "value" || vb.kind !== "value") return comparePrices(va, vb);
        return comparePrices(vb, va) || byName(a, b);
      },
      "output-price": (a, b) => comparePrices(n(a).output, n(b).output) || byName(a, b),
      context: (a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0) || byName(a, b),
      newest: (a, b) => b.created - a.created || byName(a, b),
      name: byName,
    };
    const fn = cmp[sort];
    if (fn) out = [...out].sort(fn);
  }
  if (input.limit) out = out.slice(0, input.limit);
  return out;
}

async function collectModels(ctx: Ctx, request: Record<string, unknown>): Promise<Model[]> {
  const first = await ctx.sdk.public().models.list(request);
  const all: Model[] = [];
  let pages = 0;
  for await (const page of first) {
    all.push(...page.result.data);
    if (++pages >= 20) break;
  }
  return all;
}

/** The full model list, cached (plan §8.4). */
export async function allModels(ctx: Ctx): Promise<ModelItem[]> {
  return ctx.memo("models:all", async () => {
    const res = await ctx.cache.fetch("models", TTL.models, ctx.cachePolicy, async () =>
      (await collectModels(ctx, {})).map((m) => toItem(m, true)),
    );
    ctx.meta.cached = res.cached;
    ctx.meta.fetchedAt = res.fetchedAt.toISOString();
    if (res.stale)
      ctx.meta.warnings.push("Network unavailable; showing cached model data past its 10-minute lifetime.");
    return res.data;
  });
}

function serverRequest(input: ModelsListInput): Record<string, unknown> {
  const req: Record<string, unknown> = {};
  if (input.q) req.q = input.q;
  if (input.sort && input.sort in SERVER_SORTS)
    req.sort = SERVER_SORTS[input.sort as keyof typeof SERVER_SORTS];
  if (input.maxPrice !== undefined) req.maxPrice = input.maxPrice;
  if (input.minPrice !== undefined) req.minPrice = input.minPrice;
  if (input.maxOutputPrice !== undefined) req.maxOutputPrice = input.maxOutputPrice;
  if (input.minContext !== undefined) req.context = input.minContext;
  if (input.param) req.supportedParameters = input.param;
  if (input.author) req.modelAuthors = input.author;
  if (input.zdr) req.zdr = "true";
  if (input.region) req.region = input.region;
  if (input.provider) req.providers = input.provider;
  return req;
}

export const modelsList = defineOp({
  id: "models.list",
  role: "public",
  kind: "read",
  summary: "Search models with prices ($ per million tokens)",
  input: ModelsListInput,
  async run(ctx, input) {
    let source: "cache" | "api";
    let items: ModelItem[];
    if (needsServer(input)) {
      const request = serverRequest(input);
      const key = `queries/${createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 32)}`;
      const res = await ctx.cache.fetch(key, TTL.queries, ctx.cachePolicy, async () =>
        (await collectModels(ctx, request)).map((m) => toItem(m, true)),
      );
      ctx.meta.cached = res.cached;
      ctx.meta.fetchedAt = res.fetchedAt.toISOString();
      items = res.data;
      source = "api";
      // Server order is the requested ranking; local filters only narrow it.
      items = filterModels(items, { ...input, sort: undefined });
    } else {
      items = filterModels(await allModels(ctx), input);
      source = "cache";
    }
    return {
      models: items,
      count: items.length,
      source,
      fetchedAt: ctx.meta.fetchedAt ?? null,
      cached: ctx.meta.cached,
    };
  },
});

export function splitModelId(id: string): { author: string; slug: string } {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1)
    throw usageError(`Model ids look like author/slug, got "${id}".`);
  return { author: id.slice(0, slash), slug: id.slice(slash + 1) };
}

export const modelsShow = defineOp({
  id: "models.show",
  role: "public",
  kind: "read",
  summary: "Show one model: pricing tiers, context, reasoning",
  input: z.object({ id: z.string().min(3) }),
  async run(ctx, input) {
    const { author, slug } = splitModelId(input.id);
    if (ctx.cachePolicy !== "refresh") {
      const cached = await ctx.cache.read<ModelItem[]>("models");
      const hit = cached?.data.find((m) => m.id === input.id || m.canonicalSlug === input.id);
      if (hit) {
        ctx.meta.cached = true;
        ctx.meta.fetchedAt = cached?.fetchedAt.toISOString();
        return hit;
      }
      if (ctx.cachePolicy === "offline") {
        throw new OrctlError("NOT_FOUND", `Model ${input.id} is not in the cache.`, {
          hint: cached
            ? `Similar: ${
                nearMatches(
                  input.id,
                  cached.data.map((m) => m.id),
                ).join(", ") || "none"
              }`
            : undefined,
        });
      }
    }
    try {
      const res = await ctx.sdk.public().models.get({ author, slug });
      return toItem(res.data, true);
    } catch (err) {
      const e = err as { statusCode?: number };
      if (e?.statusCode === 404) {
        const list = await allModels(ctx).catch(() => []);
        const similar = nearMatches(
          input.id,
          list.map((m) => m.id),
        );
        throw new OrctlError("NOT_FOUND", `Model ${input.id} was not found.`, {
          hint: similar.length
            ? `Did you mean: ${similar.join(", ")}?`
            : "Search with `orctl models list --q <text>`.",
        });
      }
      throw err;
    }
  },
});

export interface EndpointItem {
  provider: string;
  tag: string;
  name: string;
  contextLength: number;
  maxCompletionTokens: number | null;
  quantization: string | null;
  status: number | null;
  uptime30m: number | null;
  uptime1d: number | null;
  latencyP50: number | null;
  throughputP50: number | null;
  supportsImplicitCaching: boolean;
  pricing: PricingLike;
  price: ReturnType<typeof pricingJson>;
}

function toEndpoint(e: PublicEndpoint): EndpointItem {
  const pricing = e.pricing as unknown as PricingLike;
  return {
    provider: String(e.providerName),
    tag: e.tag,
    name: e.name,
    contextLength: e.contextLength,
    maxCompletionTokens: e.maxCompletionTokens,
    quantization: e.quantization ? String(e.quantization) : null,
    status: typeof e.status === "number" ? e.status : null,
    uptime30m: e.uptimeLast30m,
    uptime1d: e.uptimeLast1d,
    latencyP50: e.latencyLast30m?.p50 ?? null,
    throughputP50: e.throughputLast30m?.p50 ?? null,
    supportsImplicitCaching: e.supportsImplicitCaching,
    pricing,
    price: pricingJson(normalizePricing(pricing)),
  };
}

export const ENDPOINT_SORTS = ["price", "uptime", "latency", "throughput"] as const;

export const modelsEndpoints = defineOp({
  id: "models.endpoints",
  role: "public",
  kind: "read",
  summary: "Per-provider prices, uptime, latency and throughput for a model",
  input: z.object({ id: z.string().min(3), sort: z.enum(ENDPOINT_SORTS).optional() }),
  async run(ctx, input) {
    const { author, slug } = splitModelId(input.id);
    const res = await ctx.cache.fetch(
      `endpoints/${author}__${slug}`,
      TTL.endpoints,
      ctx.cachePolicy,
      async () => {
        const r = await ctx.sdk.public().endpoints.list({ author, slug });
        return { id: r.data.id, name: r.data.name, endpoints: r.data.endpoints.map(toEndpoint) };
      },
    );
    ctx.meta.cached = res.cached;
    ctx.meta.fetchedAt = res.fetchedAt.toISOString();
    const endpoints = [...res.data.endpoints];
    const num = (v: number | null, dir: 1 | -1) => (v === null ? Number.POSITIVE_INFINITY : dir * v);
    const sorters: Record<string, (a: EndpointItem, b: EndpointItem) => number> = {
      price: (a, b) =>
        comparePrices(normalizePricing(a.pricing).input, normalizePricing(b.pricing).input) ||
        comparePrices(normalizePricing(a.pricing).output, normalizePricing(b.pricing).output),
      uptime: (a, b) => num(a.uptime30m, -1) - num(b.uptime30m, -1),
      latency: (a, b) => num(a.latencyP50, 1) - num(b.latencyP50, 1),
      throughput: (a, b) => num(a.throughputP50, -1) - num(b.throughputP50, -1),
    };
    if (input.sort) endpoints.sort(sorters[input.sort]);
    return { model: { id: res.data.id, name: res.data.name }, endpoints };
  },
});
