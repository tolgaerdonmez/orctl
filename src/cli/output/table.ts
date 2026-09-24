import type { Column } from "../../core/format/columns.ts";
import { COLUMN_GAP, layoutColumns, padText, truncateText } from "../../core/format/layout.ts";
import type { Style } from "../../core/format/view.ts";

/** Aligned plain-text table (plan §5.5), using the layout shared with the TUI DataTable. */
export function renderTable<R>(
  columns: readonly Column<R>[],
  rows: readonly R[],
  opts: { maxWidth?: number | undefined; style: Style },
): string[] {
  const layout = layoutColumns(columns, rows, opts.maxWidth);
  const s = opts.style;
  const gap = " ".repeat(COLUMN_GAP);
  const header = layout.columns
    .map((c, i) => padText(truncateText(c.header, layout.widths[i] ?? 0), layout.widths[i] ?? 0, c.align))
    .join(gap)
    .trimEnd();
  const out = [s.dim(header)];
  rows.forEach((row, r) => {
    const line = layout.columns
      .map((c, i) => {
        const w = layout.widths[i] ?? 0;
        const text = padText(truncateText(layout.cells[r]?.[i] ?? "", w), w, c.align);
        const tone = c.tone?.(row);
        return tone ? s.tone(tone, text) : text;
      })
      .join(gap);
    out.push(line.replace(/\s+$/, ""));
  });
  return out;
}
