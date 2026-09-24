import {
  applyDiscount,
  formatPrice,
  isFree,
  NONE,
  type Price,
  parsePrice,
  perMillion,
  priceJson,
} from "./decimal.ts";

/**
 * Field classification (plan §8.3, from the SDK's PublicPricing doc comments):
 *   per token  → shown per million tokens ($/M)
 *   per unit   → shown as-is ($/request, $/image, $/search)
 *   discount   → price × (1 − discount), endpoint level
 *   overrides  → conditional tiers; the top-level keys are the default-condition prices
 */
export const TOKEN_FIELDS = [
  ["prompt", "input"],
  ["completion", "output"],
  ["inputCacheRead", "cache read"],
  ["inputCacheWrite", "cache write"],
  ["inputCacheWrite1h", "cache write 1h"],
  ["internalReasoning", "reasoning"],
  ["audio", "audio in"],
  ["audioOutput", "audio out"],
  ["inputAudioCache", "audio cache"],
  ["imageToken", "image tokens"],
] as const;

export const UNIT_FIELDS = [
  ["request", "request"],
  ["image", "input image"],
  ["imageOutput", "output image"],
  ["webSearch", "search"],
] as const;

type TokenField = (typeof TOKEN_FIELDS)[number][0];
type UnitField = (typeof UNIT_FIELDS)[number][0];

export interface PricingOverrideLike {
  minPromptTokens?: number | undefined;
  utcDays?: string[] | undefined;
  utcStart?: number | undefined;
  utcEnd?: number | undefined;
  [field: string]: unknown;
}

export interface PricingLike {
  prompt: string;
  completion: string;
  discount?: number | undefined;
  overrides?: PricingOverrideLike[] | undefined;
  [field: string]: unknown;
}

export interface Tier {
  condition: string;
  /** Per-million prices for the token fields this tier changes. */
  prices: Array<{ field: string; label: string; perMillion: Price }>;
}

export interface NormalizedPricing {
  input: Price;
  output: Price;
  cacheRead: Price;
  cacheWrite: Price;
  free: boolean;
  variable: boolean;
  tiered: boolean;
  discount: number;
  perToken: Array<{ field: TokenField; label: string; perMillion: Price }>;
  perUnit: Array<{ field: UnitField; label: string; price: Price }>;
  tiers: Tier[];
}

const pm = (p: PricingLike, field: string, discount: number): Price =>
  perMillion(applyDiscount(parsePrice(p[field] as string | undefined), discount));

const DAY_SHORT: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const hour = (h: number) =>
  `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

export function describeCondition(o: PricingOverrideLike): string {
  const parts: string[] = [];
  if (o.minPromptTokens !== undefined) {
    const k =
      o.minPromptTokens >= 1000 ? `${Math.round(o.minPromptTokens / 1000)}K` : String(o.minPromptTokens);
    parts.push(`≥${k} prompt tokens`);
  }
  if (o.utcDays?.length) parts.push(o.utcDays.map((d) => DAY_SHORT[d] ?? d).join(","));
  if (o.utcStart !== undefined || o.utcEnd !== undefined) {
    parts.push(`${hour(o.utcStart ?? 0)}–${hour(o.utcEnd ?? 24)} UTC`);
  }
  return parts.join(" · ") || "conditional";
}

export function normalizePricing(pricing: PricingLike): NormalizedPricing {
  const discount = typeof pricing.discount === "number" ? pricing.discount : 0;
  const input = pm(pricing, "prompt", discount);
  const output = pm(pricing, "completion", discount);
  const perToken = TOKEN_FIELDS.map(([field, label]) => ({
    field,
    label,
    perMillion: pm(pricing, field, discount),
  })).filter((f) => f.perMillion.kind !== "none");
  const perUnit = UNIT_FIELDS.map(([field, label]) => ({
    field,
    label,
    price: applyDiscount(parsePrice(pricing[field] as string | undefined), discount),
  })).filter((f) => f.price.kind !== "none");
  const tiers: Tier[] = (pricing.overrides ?? []).map((o) => ({
    condition: describeCondition(o),
    prices: TOKEN_FIELDS.filter(([field]) => o[field] !== undefined).map(([field, label]) => ({
      field,
      label,
      perMillion: perMillion(applyDiscount(parsePrice(o[field] as string), discount)),
    })),
  }));
  return {
    input,
    output,
    cacheRead: pm(pricing, "inputCacheRead", discount),
    cacheWrite: pm(pricing, "inputCacheWrite", discount),
    free: isFree(input) && isFree(output),
    variable: input.kind === "variable" || output.kind === "variable",
    tiered: tiers.length > 0,
    discount,
    perToken,
    perUnit,
    tiers,
  };
}

/** "$0.15/M", "free", "variable". */
export function formatPerMillion(p: Price): string {
  if (p.kind === "none") return "—";
  const text = formatPrice(p, { free: "free" });
  return p.kind === "value" && p.atto !== 0n ? `${text}/M` : text;
}

/** Flags column: ⚑ tiered · FREE · VAR (plan §7.3). */
export function pricingFlags(n: NormalizedPricing): string {
  return [n.tiered ? "⚑" : "", n.free ? "FREE" : "", n.variable ? "VAR" : ""].filter(Boolean).join(" ");
}

/** Exact decimal strings for --json output. */
export function pricingJson(n: NormalizedPricing) {
  return {
    inputPerMillion: priceJson(n.input),
    outputPerMillion: priceJson(n.output),
    cacheReadPerMillion: priceJson(n.cacheRead),
    cacheWritePerMillion: priceJson(n.cacheWrite),
    free: n.free,
    variable: n.variable,
    tiered: n.tiered,
    discount: n.discount,
    perMillion: Object.fromEntries(n.perToken.map((f) => [f.field, priceJson(f.perMillion)])),
    perUnit: Object.fromEntries(n.perUnit.map((f) => [f.field, priceJson(f.price)])),
    tiers: n.tiers.map((t) => ({
      condition: t.condition,
      perMillion: Object.fromEntries(t.prices.map((p) => [p.field, priceJson(p.perMillion)])),
    })),
  };
}

export { NONE };
