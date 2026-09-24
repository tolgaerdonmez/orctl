import type { ProfileColor } from "../profile/schema.ts";
import type { Column, Tone } from "./columns.ts";

/**
 * How an operation's result is presented as text. Both the CLI (stdout) and the TUI (generic
 * result panes) render these; `--json` bypasses them and prints the raw result.
 */
export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  tone(tone: Tone, s: string): string;
  color(color: ProfileColor | string | null | undefined, s: string): string;
}

export const plainStyle: Style = {
  bold: (s) => s,
  dim: (s) => s,
  tone: (_t, s) => s,
  color: (_c, s) => s,
};

export interface TableView<O, R> {
  kind: "table";
  rows(output: O): R[];
  /** Static columns, or a factory when values depend on the current time (e.g. "expires in"). */
  columns: readonly Column<R>[] | ((now: Date) => readonly Column<R>[]);
  /** Lines printed above the table (e.g. a data-source note). */
  header?(output: O, style: Style, now: Date): string[];
  footer?(output: O, style: Style, now: Date): string[];
  empty: string;
}

export interface LinesView<O> {
  kind: "lines";
  lines(output: O, style: Style, now: Date): string[];
}

// biome-ignore lint/suspicious/noExplicitAny: views are keyed by op id with heterogeneous outputs.
export type View = TableView<any, any> | LinesView<any>;

export function table<O, R>(view: Omit<TableView<O, R>, "kind">): TableView<O, R> {
  return { kind: "table", ...view };
}

export function columnsOf<R>(view: TableView<unknown, R>, now: Date): readonly Column<R>[] {
  return typeof view.columns === "function" ? view.columns(now) : view.columns;
}

export function lines<O>(fn: LinesView<O>["lines"]): LinesView<O> {
  return { kind: "lines", lines: fn };
}

export const glyph = {
  ok: "✔",
  warn: "!",
  fail: "✖",
  skip: "–",
  dot: "●",
  arrow: "→",
} as const;

/** Aligned "Label  value" rows. */
export function kv(rows: Array<[string, string]>, style: Style): string[] {
  const width = Math.max(0, ...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${style.dim(k.padEnd(width))}  ${v}`);
}
