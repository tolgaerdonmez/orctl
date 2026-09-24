/**
 * Exact price arithmetic (plan §8.3). OpenRouter reports prices as decimal strings in USD per
 * token (or per unit). They are held as bigint in units of 1e-18 USD, so no float rounding ever
 * reaches a comparison or a displayed $/M figure. The smallest live price is 0.000000017 (9
 * decimals), well inside 18.
 */
export const DECIMALS = 18;
const SCALE = 10n ** BigInt(DECIMALS);
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export type Price =
  | { kind: "value"; atto: bigint; approx?: boolean }
  /** "-1": routers such as openrouter/auto whose price depends on the routed model. */
  | { kind: "variable" }
  | { kind: "none" };

export const NONE: Price = { kind: "none" };

export function parsePrice(raw: string | number | null | undefined): Price {
  if (raw === null || raw === undefined || raw === "") return NONE;
  const text = String(raw).trim();
  const m = text.match(DECIMAL);
  if (m) {
    const [, sign, whole = "0", frac = ""] = m;
    if (sign === "-") return { kind: "variable" };
    return { kind: "value", atto: toAtto(whole, frac) };
  }
  // Scientific notation does not occur in live data; accept it defensively as approximate.
  const n = Number(text);
  if (!Number.isFinite(n)) return NONE;
  if (n < 0) return { kind: "variable" };
  const fixed = n.toFixed(DECIMALS);
  const [whole = "0", frac = ""] = fixed.split(".");
  return { kind: "value", atto: toAtto(whole, frac), approx: true };
}

function toAtto(whole: string, frac: string): bigint {
  const digits = frac.slice(0, DECIMALS).padEnd(DECIMALS, "0");
  let atto = BigInt(whole) * SCALE + BigInt(digits);
  // round half up on the first dropped digit
  if (frac.length > DECIMALS && Number(frac[DECIMALS]) >= 5) atto += 1n;
  return atto;
}

export function isFree(p: Price): boolean {
  return p.kind === "value" && p.atto === 0n;
}

export function scale(p: Price, factor: bigint): Price {
  return p.kind === "value" ? { ...p, atto: p.atto * factor } : p;
}

/** USD per token → USD per million tokens. */
export function perMillion(p: Price): Price {
  return scale(p, 1_000_000n);
}

/** price × (1 − discount), discount in [0, 1] (endpoint-level). */
export function applyDiscount(p: Price, discount: number | undefined): Price {
  if (p.kind !== "value" || !discount) return p;
  const keep = BigInt(Math.round((1 - Math.min(1, Math.max(0, discount))) * 1_000_000));
  return { ...p, atto: (p.atto * keep) / 1_000_000n };
}

/** Sort comparator: ascending values first, then "none", then "variable" last (plan §8.3). */
export function comparePrices(a: Price, b: Price): number {
  const rank = (p: Price) => (p.kind === "value" ? 0 : p.kind === "none" ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.kind === "value" && b.kind === "value") return a.atto < b.atto ? -1 : a.atto > b.atto ? 1 : 0;
  return 0;
}

/** Decimal string for a USD amount given in 1e-18 units, without float conversion. */
export function attoToDecimal(atto: bigint): string {
  const neg = atto < 0n;
  const abs = neg ? -atto : atto;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Human amount: at most 4 decimals at or above 1, at most 4 significant digits below 1, trailing
 * zeros trimmed (plan §8.3). "0.000000017"/token → 0.017 per million; "0.00003" → 30.
 */
export function formatAmount(atto: bigint): string {
  if (atto === 0n) return "0";
  const abs = atto < 0n ? -atto : atto;
  let decimals: number;
  if (abs >= SCALE) decimals = 4;
  else {
    const digits = abs.toString().length; // significant digits below one
    const leadingZeros = DECIMALS - digits;
    decimals = Math.min(DECIMALS, leadingZeros + 4);
  }
  const unit = 10n ** BigInt(DECIMALS - decimals);
  const rounded = ((abs + unit / 2n) / unit) * unit;
  const text = attoToDecimal(rounded);
  return atto < 0n ? `-${text}` : text;
}

/** "$0.15" / "free" / "variable" / "—". */
export function formatPrice(p: Price, opts: { free?: string; none?: string } = {}): string {
  if (p.kind === "variable") return "variable";
  if (p.kind === "none") return opts.none ?? "—";
  if (p.atto === 0n) return opts.free ?? "$0";
  return `${p.approx ? "~" : ""}$${formatAmount(p.atto)}`;
}

/** Numeric value for JSON output: a decimal string (exact) or null. */
export function priceJson(p: Price): string | null {
  if (p.kind === "variable") return "variable";
  if (p.kind === "none") return null;
  return attoToDecimal(p.atto);
}

/** A $/M user input (e.g. --max-price 1.5) as an exact per-million price. */
export function parseUserAmount(value: number): Price {
  return parsePrice(value.toString());
}
