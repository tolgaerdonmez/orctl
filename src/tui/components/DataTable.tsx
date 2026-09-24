import { useState } from "react";
import type { Column } from "../../core/format/columns.ts";
import { COLUMN_GAP, formatHeader, layoutColumns, padText, truncateText } from "../../core/format/layout.ts";
import { theme, toneHex } from "../theme.ts";

/**
 * Selectable table rendered from the same Column definitions the CLI prints (plan §3.3, §5.5),
 * so both surfaces show identical values. Only the visible window of rows is rendered.
 */
export function DataTable<R>(props: {
  columns: readonly Column<R>[];
  rows: readonly R[];
  selected: number;
  width: number;
  height: number;
  empty?: string | undefined;
  rowKey?: ((row: R, index: number) => string) | undefined;
}) {
  const { columns, rows, selected, width, height } = props;
  const [offset, setOffset] = useState(0);
  const visible = Math.max(1, height - 1);
  let start = offset;
  if (selected < start) start = selected;
  if (selected >= start + visible) start = selected - visible + 1;
  start = Math.max(0, Math.min(start, Math.max(0, rows.length - visible)));
  if (start !== offset) queueMicrotask(() => setOffset(start));

  const layout = layoutColumns(columns, rows, width);
  if (rows.length === 0) {
    return (
      <box flexDirection="column" height={height}>
        <text fg={theme.muted}>{props.empty ?? "Nothing to show."}</text>
      </box>
    );
  }
  const gap = " ".repeat(COLUMN_GAP);
  return (
    <box flexDirection="column" height={height}>
      <text fg={theme.muted}>{formatHeader(layout)}</text>
      {rows.slice(start, start + visible).map((row, i) => {
        const index = start + i;
        const isSelected = index === selected;
        const key = props.rowKey ? props.rowKey(row, index) : String(index);
        const cells = layout.columns.map((c, ci) => {
          const w = layout.widths[ci] ?? 0;
          return {
            text: padText(truncateText(layout.cells[index]?.[ci] ?? "", w), w, c.align),
            tone: c.tone?.(row),
          };
        });
        const used = cells.reduce((n, c) => n + Bun.stringWidth(c.text), 0) + gap.length * (cells.length - 1);
        return (
          <text key={key} bg={isSelected ? theme.selectionBg : undefined}>
            {cells.map((c, ci) => (
              <span
                key={layout.columns[ci]?.id ?? ci}
                fg={toneHex(c.tone) ?? (isSelected ? theme.selectionFg : theme.fg)}
              >
                {ci === 0 ? c.text : `${gap}${c.text}`}
              </span>
            ))}
            {isSelected ? <span>{" ".repeat(Math.max(0, width - used))}</span> : null}
          </text>
        );
      })}
    </box>
  );
}

/** Keyboard navigation for a list: returns a handler for up/down/page/home/end and j/k. */
export function listKeys(
  id: string,
  count: number,
  selected: number,
  setSelected: (n: number) => void,
  pageSize = 10,
): boolean {
  if (count === 0) return false;
  const clamp = (n: number) => Math.max(0, Math.min(count - 1, n));
  switch (id) {
    case "up":
    case "k":
      setSelected(clamp(selected - 1));
      return true;
    case "down":
    case "j":
      setSelected(clamp(selected + 1));
      return true;
    case "pageup":
      setSelected(clamp(selected - pageSize));
      return true;
    case "pagedown":
      setSelected(clamp(selected + pageSize));
      return true;
    case "home":
    case "g":
      setSelected(0);
      return true;
    case "end":
    case "G":
      setSelected(count - 1);
      return true;
    default:
      return false;
  }
}
