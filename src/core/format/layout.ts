import type { Column } from "./columns.ts";
import { sanitizeCell } from "./sanitize.ts";

/**
 * Column layout shared by the CLI table and the TUI DataTable (plan §5.5): both drop the least
 * important columns first on narrow screens, then shrink the widest text column.
 */
export const COLUMN_GAP = 2;

export function textWidth(text: string): number {
  return Bun.stringWidth(text);
}

export function truncateText(text: string, width: number): string {
  if (textWidth(text) <= width) return text;
  if (width <= 1) return "…".slice(0, Math.max(0, width));
  let out = "";
  for (const ch of text) {
    if (textWidth(`${out}${ch}…`) > width) break;
    out += ch;
  }
  return `${out}…`;
}

export function padText(text: string, width: number, align: "left" | "right" | undefined): string {
  const gap = Math.max(0, width - textWidth(text));
  return align === "right" ? `${" ".repeat(gap)}${text}` : `${text}${" ".repeat(gap)}`;
}

export interface ColumnLayout<R> {
  columns: Column<R>[];
  widths: number[];
  /** Sanitized cell text per row, aligned with `columns`. */
  cells: string[][];
}

export function layoutColumns<R>(
  columns: readonly Column<R>[],
  rows: readonly R[],
  maxWidth?: number,
): ColumnLayout<R> {
  let cols = [...columns];
  const cellsFor = (cs: Column<R>[]) => rows.map((r) => cs.map((c) => sanitizeCell(c.value(r))));
  const widthsFor = (cs: Column<R>[], cells: string[][]) =>
    cs.map((c, i) =>
      Math.max(c.minWidth ?? 0, textWidth(c.header), ...cells.map((row) => textWidth(row[i] ?? ""))),
    );
  let cells = cellsFor(cols);
  let widths = widthsFor(cols, cells);
  const total = (ws: number[]) => ws.reduce((a, b) => a + b, 0) + COLUMN_GAP * Math.max(0, ws.length - 1);

  if (maxWidth) {
    while (total(widths) > maxWidth && cols.length > 1) {
      const maxPriority = Math.max(...cols.map((c) => c.priority));
      if (maxPriority <= 0) break;
      const dropIndex = cols.map((c) => c.priority).lastIndexOf(maxPriority);
      cols = cols.filter((_, i) => i !== dropIndex);
      cells = cellsFor(cols);
      widths = widthsFor(cols, cells);
    }
    const over = total(widths) - maxWidth;
    if (over > 0) {
      let widest = -1;
      cols.forEach((c, i) => {
        if (c.align !== "right" && (widest < 0 || (widths[i] ?? 0) > (widths[widest] ?? 0))) widest = i;
      });
      if (widest >= 0) widths[widest] = Math.max(8, (widths[widest] ?? 0) - over);
    }
  }
  return { columns: cols, widths, cells };
}

/** One formatted line (no styling) for a row of a layout. */
export function formatRow<R>(layout: ColumnLayout<R>, rowIndex: number): string {
  return layout.columns
    .map((c, i) => {
      const w = layout.widths[i] ?? 0;
      return padText(truncateText(layout.cells[rowIndex]?.[i] ?? "", w), w, c.align);
    })
    .join(" ".repeat(COLUMN_GAP))
    .replace(/\s+$/, "");
}

export function formatHeader<R>(layout: ColumnLayout<R>): string {
  return layout.columns
    .map((c, i) => padText(truncateText(c.header, layout.widths[i] ?? 0), layout.widths[i] ?? 0, c.align))
    .join(" ".repeat(COLUMN_GAP))
    .trimEnd();
}
