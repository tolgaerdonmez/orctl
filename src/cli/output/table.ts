import type { Column } from "../../core/format/columns.ts";
import { sanitizeCell } from "../../core/format/sanitize.ts";
import type { Style } from "../../core/format/view.ts";

const GAP = "  ";

function truncate(text: string, width: number): string {
  if (Bun.stringWidth(text) <= width) return text;
  if (width <= 1) return "…".slice(0, width);
  let out = "";
  for (const ch of text) {
    if (Bun.stringWidth(`${out}${ch}…`) > width) break;
    out += ch;
  }
  return `${out}…`;
}

function pad(text: string, width: number, align: "left" | "right" | undefined): string {
  const gap = Math.max(0, width - Bun.stringWidth(text));
  return align === "right" ? `${" ".repeat(gap)}${text}` : `${text}${" ".repeat(gap)}`;
}

/**
 * Aligned plain-text table (plan §5.5). On narrow terminals the least important columns
 * (highest priority number) are dropped first, then the widest left-aligned column is truncated.
 */
export function renderTable<R>(
  columns: readonly Column<R>[],
  rows: readonly R[],
  opts: { maxWidth?: number | undefined; style: Style },
): string[] {
  let cols = [...columns];
  const cellsFor = (cs: Column<R>[]) => rows.map((r) => cs.map((c) => sanitizeCell(c.value(r))));
  const widthsFor = (cs: Column<R>[], cells: string[][]) =>
    cs.map((c, i) =>
      Math.max(
        c.minWidth ?? 0,
        Bun.stringWidth(c.header),
        ...cells.map((row) => Bun.stringWidth(row[i] ?? "")),
      ),
    );
  let cells = cellsFor(cols);
  let widths = widthsFor(cols, cells);
  const total = (ws: number[]) => ws.reduce((a, b) => a + b, 0) + GAP.length * Math.max(0, ws.length - 1);

  if (opts.maxWidth) {
    while (total(widths) > opts.maxWidth && cols.length > 1) {
      const maxPriority = Math.max(...cols.map((c) => c.priority));
      if (maxPriority <= 0) break;
      const dropIndex = cols.map((c) => c.priority).lastIndexOf(maxPriority);
      cols = cols.filter((_, i) => i !== dropIndex);
      cells = cellsFor(cols);
      widths = widthsFor(cols, cells);
    }
    const over = total(widths) - opts.maxWidth;
    if (over > 0) {
      let widest = -1;
      cols.forEach((c, i) => {
        if (c.align !== "right" && (widest < 0 || (widths[i] ?? 0) > (widths[widest] ?? 0))) widest = i;
      });
      if (widest >= 0) widths[widest] = Math.max(8, (widths[widest] ?? 0) - over);
    }
  }

  const s = opts.style;
  const header = cols
    .map((c, i) => pad(truncate(c.header, widths[i] ?? 0), widths[i] ?? 0, c.align))
    .join(GAP)
    .trimEnd();
  const out = [s.dim(header)];
  rows.forEach((row, r) => {
    const line = cols
      .map((c, i) => {
        const w = widths[i] ?? 0;
        const text = pad(truncate(cells[r]?.[i] ?? "", w), w, c.align);
        const tone = c.tone?.(row);
        return tone ? s.tone(tone, text) : text;
      })
      .join(GAP);
    out.push(line.replace(/\s+$/, ""));
  });
  return out;
}
