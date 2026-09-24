/**
 * Column definitions shared by the CLI table renderer and the TUI DataTable (plan §5.5), so both
 * surfaces show the same numbers formatted the same way.
 */
export interface Column<R> {
  id: string;
  header: string;
  value(row: R): string;
  align?: "left" | "right" | undefined;
  minWidth?: number | undefined;
  /** Lower is more important; the narrowest terminals keep only the lowest priorities. */
  priority: number;
  /** Hidden unless requested with --columns +<id>. */
  optional?: boolean | undefined;
  /** Semantic tone for coloring (e.g. disabled keys dim, errors red). */
  tone?(row: R): Tone | undefined;
}

export type Tone = "muted" | "good" | "warn" | "bad" | "accent";

// biome-ignore lint/suspicious/noExplicitAny: columns are heterogeneous across views.
export type AnyColumn = Column<any>;

/**
 * Resolves `--columns` (plan §5.5): a plain list selects exactly those columns; entries prefixed
 * with `+` add optional columns to the defaults.
 */
export function selectColumns<R>(all: readonly Column<R>[], spec?: string): Column<R>[] {
  const defaults = all.filter((c) => !c.optional);
  if (!spec) return defaults;
  const parts = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const additive = parts.every((p) => p.startsWith("+"));
  const find = (id: string) => {
    const col = all.find((c) => c.id === id);
    if (!col)
      throw new ColumnError(
        id,
        all.map((c) => c.id),
      );
    return col;
  };
  if (additive)
    return [...defaults, ...parts.map((p) => find(p.slice(1))).filter((c) => !defaults.includes(c))];
  return parts.map((p) => find(p.replace(/^\+/, "")));
}

export class ColumnError extends Error {
  constructor(
    readonly column: string,
    readonly available: string[],
  ) {
    super(`Unknown column "${column}". Available: ${available.join(", ")}`);
  }
}
