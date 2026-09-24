import type { Column } from "../../core/format/columns.ts";
import { sanitizeCell } from "../../core/format/sanitize.ts";

/** Guards against spreadsheet formula injection from API-provided names. */
function neutralize(value: string): string {
  if (/^[=+@\t\r]/.test(value) || /^-[^0-9.]/.test(value)) return `'${value}`;
  return value;
}

function quote(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC 4180 CSV using the same column definitions as the table (header row = column ids). */
export function renderCsv<R>(columns: readonly Column<R>[], rows: readonly R[]): string[] {
  const out = [columns.map((c) => quote(c.id)).join(",")];
  for (const row of rows) {
    out.push(columns.map((c) => quote(neutralize(sanitizeCell(c.value(row))))).join(","));
  }
  return out;
}
