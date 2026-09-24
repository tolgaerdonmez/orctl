/** Dollar amounts as the API reports them (floats for account data; prices use pricing/decimal). */
export function formatUsd(value: number | null | undefined, opts: { empty?: string } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return opts.empty ?? "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs === 0) return "$0.00";
  if (abs < 0.01) return `${sign}$${trimZeros(abs.toFixed(4))}`;
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** "$20.00 / $8.10 left", "no limit". */
export function formatLimit(limit: number | null, remaining: number | null): string {
  if (limit === null) return "no limit";
  return `${formatUsd(limit)} / ${formatUsd(remaining)} left`;
}

export function percentUsed(limit: number | null, remaining: number | null): number | null {
  if (limit === null || remaining === null || limit <= 0) return null;
  return Math.max(0, Math.min(1, (limit - remaining) / limit));
}
