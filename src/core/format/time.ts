import { usageError } from "../errors.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function toDate(value: string | Date | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-09-24" in UTC. */
export function formatDay(value: string | Date | number | null | undefined, empty = "—"): string {
  const d = toDate(value);
  return d ? d.toISOString().slice(0, 10) : empty;
}

/** "3m ago", "in 12d", "just now". */
export function relativeTime(
  value: string | Date | number | null | undefined,
  now: Date,
  empty = "—",
): string {
  const d = toDate(value);
  if (!d) return empty;
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  const fmt =
    abs < HOUR
      ? `${Math.round(abs / MINUTE)}m`
      : abs < DAY
        ? `${Math.round(abs / HOUR)}h`
        : `${Math.round(abs / DAY)}d`;
  return diff < 0 ? `${fmt} ago` : `in ${fmt}`;
}

export function daysUntil(value: string | Date | null | undefined, now: Date): number | null {
  const d = toDate(value ?? null);
  return d ? (d.getTime() - now.getTime()) / DAY : null;
}

/** ISO 8601 UTC with second precision; the keys API rejects minute precision (plan §8.1). */
export function isoSeconds(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

/**
 * `--expires` values: an ISO timestamp, a date (end of that UTC day), or a relative duration such
 * as 30d / 12h / 2w. Returns a Date with second precision.
 */
export function parseExpires(value: string, now: Date): Date {
  const v = value.trim();
  const rel = v.match(/^(\d+)\s*([hdw])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = (rel[2] ?? "d").toLowerCase();
    const ms = unit === "h" ? n * HOUR : unit === "w" ? n * 7 * DAY : n * DAY;
    if (n <= 0) throw usageError(`--expires must be in the future, got "${value}".`);
    return new Date(Math.floor((now.getTime() + ms) / 1000) * 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T23:59:59Z`);
    if (Number.isNaN(d.getTime())) throw usageError(`Invalid date "${value}".`);
    if (d.getTime() <= now.getTime()) throw usageError(`--expires must be in the future, got "${value}".`);
    return d;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw usageError(
      `Invalid --expires "${value}".`,
      "Use an ISO timestamp, a date like 2027-12-31, or a duration like 30d.",
    );
  }
  if (d.getTime() <= now.getTime()) throw usageError(`--expires must be in the future, got "${value}".`);
  return new Date(Math.floor(d.getTime() / 1000) * 1000);
}
