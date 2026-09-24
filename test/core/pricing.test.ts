import { describe, expect, test } from "bun:test";
import {
  applyDiscount,
  attoToDecimal,
  comparePrices,
  formatAmount,
  formatPrice,
  parsePrice,
  perMillion,
  priceJson,
} from "../../src/core/pricing/decimal.ts";
import {
  describeCondition,
  formatPerMillion,
  normalizePricing,
  pricingFlags,
} from "../../src/core/pricing/normalize.ts";

const pm = (s: string) => formatPerMillion(perMillion(parsePrice(s)));

describe("exact price arithmetic (plan §8.3)", () => {
  test("per-token strings become $/M without float error", () => {
    expect(pm("0.000000017")).toBe("$0.017/M");
    expect(pm("0.00003")).toBe("$30/M");
    expect(pm("0.00000015")).toBe("$0.15/M");
    expect(pm("0.0000001")).toBe("$0.1/M");
    expect(pm("0.000000123456789")).toBe("$0.1235/M");
    // classic float trap: 0.1 + 0.2
    const sum = (parsePrice("0.1") as { atto: bigint }).atto + (parsePrice("0.2") as { atto: bigint }).atto;
    expect(attoToDecimal(sum)).toBe("0.3");
  });

  test("special values: -1 variable, 0 free, empty none", () => {
    expect(parsePrice("-1")).toEqual({ kind: "variable" });
    expect(formatPrice(parsePrice("-1"))).toBe("variable");
    expect(formatPrice(parsePrice("0"), { free: "free" })).toBe("free");
    expect(parsePrice(undefined)).toEqual({ kind: "none" });
    expect(parsePrice("")).toEqual({ kind: "none" });
  });

  test("scientific notation is accepted but marked approximate", () => {
    const p = parsePrice("1e-7");
    expect(p).toMatchObject({ kind: "value", approx: true });
    expect(formatPerMillion(perMillion(p))).toBe("~$0.1/M");
  });

  test("rounding and significant digits", () => {
    expect(formatAmount(1234567n * 10n ** 12n)).toBe("1.2346");
    expect(formatAmount(12345n * 10n ** 9n)).toBe("0.00001235");
    expect(priceJson(perMillion(parsePrice("0.000000017")))).toBe("0.017");
  });

  test("ordering: values ascending, then none, then variable", () => {
    const list = ["-1", "0.00001", "", "0", "0.000001"].map(parsePrice).sort(comparePrices);
    expect(list.map((p) => formatPrice(p, { free: "free" }))).toEqual([
      "free",
      "$0.000001",
      "$0.00001",
      "—",
      "variable",
    ]);
  });

  test("discount applies as price × (1 − discount)", () => {
    expect(formatPerMillion(perMillion(applyDiscount(parsePrice("0.000001"), 0.2)))).toBe("$0.8/M");
  });
});

describe("pricing normalization", () => {
  test("tiers from overrides, per-unit fields, flags", () => {
    const n = normalizePricing({
      prompt: "0.0000001",
      completion: "0.0000005",
      webSearch: "0.01",
      inputCacheRead: "0.00000001",
      overrides: [{ minPromptTokens: 272000, prompt: "0.0000002", completion: "0.00000075" }],
    });
    expect(n.tiered).toBe(true);
    expect(pricingFlags(n)).toBe("⚑");
    expect(n.tiers[0]?.condition).toBe("≥272K prompt tokens");
    expect(n.tiers[0]?.prices.map((p) => `${p.label} ${formatPerMillion(p.perMillion)}`)).toEqual([
      "input $0.2/M",
      "output $0.75/M",
    ]);
    expect(n.perUnit.map((u) => `${u.label}=${formatPrice(u.price)}`)).toEqual(["search=$0.01"]);
    expect(formatPerMillion(n.cacheRead)).toBe("$0.01/M");
  });

  test("free and variable flags", () => {
    expect(pricingFlags(normalizePricing({ prompt: "0", completion: "0" }))).toBe("FREE");
    expect(pricingFlags(normalizePricing({ prompt: "-1", completion: "-1" }))).toBe("VAR");
  });

  test("time-window conditions", () => {
    expect(describeCondition({ utcDays: ["monday", "friday"], utcStart: 0, utcEnd: 8.5 })).toBe(
      "Mon,Fri · 00:00–08:30 UTC",
    );
  });
});
