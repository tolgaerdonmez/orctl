import { mapError } from "../core/client/map-error.ts";
import { createContext } from "../core/context.ts";
import { ExitCode, OrctlError } from "../core/errors.ts";
import { ColumnError, selectColumns } from "../core/format/columns.ts";
import type { View } from "../core/format/view.ts";
import { viewFor } from "../core/format/views.ts";
import { messages } from "../core/messages.ts";
import { getOp } from "../core/ops/registry.ts";
import type { AnyOperation, CachePolicy, Ctx } from "../core/ops/types.ts";
import type { CommandSpec } from "../surface/spec.ts";
import { type CliDeps, colorEnabled, type GlobalOptions } from "./io.ts";
import { renderCsv } from "./output/csv.ts";
import { envelopeMeta, errorEnvelope, successEnvelope } from "./output/json.ts";
import { finalize, markerStyle } from "./output/style.ts";
import { renderTable } from "./output/table.ts";
import { clackPrompter, confirmDestructive } from "./prompts.ts";

export function cachePolicyOf(globals: GlobalOptions): CachePolicy {
  if (globals.refresh && globals.offline)
    throw new OrctlError("USAGE", "Use either --refresh or --offline, not both.");
  return globals.offline ? "offline" : globals.refresh ? "refresh" : "default";
}

export function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 600)
    throw new OrctlError("USAGE", `--timeout must be 1–600 seconds, got "${raw}".`);
  return n;
}

class Printer {
  readonly color: boolean;
  constructor(
    private readonly deps: CliDeps,
    private readonly globals: GlobalOptions,
  ) {
    this.color = colorEnabled(globals, deps);
  }
  out(lines: string[]) {
    if (lines.length === 0) return;
    this.deps.stdout(`${lines.map((l) => finalize(l, this.color)).join("\n")}\n`);
  }
  raw(text: string) {
    this.deps.stdout(`${text}\n`);
  }
  err(lines: string[]) {
    const color = colorEnabled(this.globals, { ...this.deps, stdoutIsTTY: this.deps.stdoutIsTTY });
    this.deps.stderr(`${lines.map((l) => finalize(l, color)).join("\n")}\n`);
  }
}

function renderView(
  view: View,
  result: unknown,
  ctx: Ctx,
  globals: GlobalOptions,
  deps: CliDeps,
  p: Printer,
  spec: CommandSpec,
) {
  const now = ctx.clock.now();
  if (view.kind === "lines") {
    if (globals.csv) throw new OrctlError("USAGE", `--csv is only available for list commands.`);
    p.out(view.lines(result, markerStyle, now));
    return;
  }
  let columns: ReturnType<typeof selectColumns>;
  try {
    columns = selectColumns(view.columns, globals.columns);
  } catch (err) {
    if (err instanceof ColumnError) throw new OrctlError("USAGE", err.message);
    throw err;
  }
  const rows = view.rows(result);
  if (globals.csv) {
    if (!spec.list) throw new OrctlError("USAGE", `--csv is only available for list commands.`);
    p.raw(renderCsv(columns, rows).join("\n"));
    return;
  }
  const header = view.header?.(result, markerStyle, now) ?? [];
  const footer = view.footer?.(result, markerStyle, now) ?? [];
  if (rows.length === 0) {
    p.out([...header, markerStyle.dim(view.empty), ...footer]);
    return;
  }
  const maxWidth = deps.stdoutIsTTY ? (deps.columns ?? 100) : undefined;
  p.out([...header, ...renderTable(columns, rows, { maxWidth, style: markerStyle }), ...footer]);
}

function banner(op: AnyOperation, ctx: Ctx, input: Record<string, unknown>): string {
  const profile = ctx.profile;
  const ws = (typeof input.workspace === "string" && input.workspace) || profile?.workspace || "default";
  const who = profile ? markerStyle.color(profile.color, `profile ${profile.name}`) : "no profile";
  return markerStyle.dim(`→ ${who} · workspace ${ws} · ${op.id}`);
}

/**
 * Shared CLI flow for every operation: validate input → build context → role check →
 * confirmation → banner → run → render → exit code (plan §5.2, §5.4, §5.5).
 */
export async function runOp(
  spec: CommandSpec,
  rawInput: Record<string, unknown>,
  globals: GlobalOptions,
  deps: CliDeps,
): Promise<number> {
  const op = getOp(spec.op);
  const p = new Printer(deps, globals);
  let ctx: Ctx | undefined;
  try {
    const parsed = op.input.safeParse(rawInput);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("; ");
      throw new OrctlError("USAGE", detail);
    }
    const input = parsed.data as Record<string, unknown>;
    ctx = await createContext(deps, {
      profile: globals.profile,
      config: globals.config,
      debug: globals.debug,
      timeoutSeconds: parseTimeout(globals.timeout),
      cachePolicy: cachePolicyOf(globals),
    });
    if ((op.role === "management" || op.role === "user") && !op.profileOptional) {
      if (ctx.profileError) throw ctx.profileError;
      if (!ctx.profile)
        throw new OrctlError("NO_CREDENTIAL", messages.noProfile, { hint: messages.addProfileHint });
    }
    if (op.role === "public" && ctx.profileError) ctx.meta.warnings.push(ctx.profileError.message);

    if (op.kind === "destructive" && !globals.yes) {
      if (!(deps.stdinIsTTY && deps.stdoutIsTTY) || globals.json) {
        throw new OrctlError("USAGE", messages.confirmationRequired);
      }
      const confirmation = op.confirm ? await op.confirm(ctx, input) : { prompt: `Run ${op.id}?` };
      await confirmDestructive(deps.prompter ?? clackPrompter, confirmation.prompt, confirmation.typed);
    }
    if (op.kind !== "read" && op.role !== "local" && !globals.quiet && !globals.json) {
      p.err([banner(op, ctx, input)]);
    }

    const result = await op.run(ctx, input);
    const revealKey = Boolean(input.show);

    if (globals.json) {
      p.raw(successEnvelope(result, envelopeMeta(op.id, ctx.profile, ctx.meta), { revealKey }));
    } else {
      if (!globals.quiet && ctx.meta.warnings.length)
        p.err(ctx.meta.warnings.map((w) => markerStyle.tone("warn", `! ${w}`)));
      const view = viewFor(op.id);
      if (view) renderView(view, result, ctx, globals, deps, p, spec);
      else p.raw(JSON.stringify(result, null, 2));
    }
    return ctx.meta.exit ?? ExitCode.OK;
  } catch (err) {
    const e = mapError(err, {
      mutation: op.kind !== "read",
      role: op.role === "local" ? undefined : op.role,
      profile: ctx?.profile?.name,
      rateLimit: ctx?.sdk.rateLimit,
    });
    if (globals.json) {
      p.raw(errorEnvelope(e, envelopeMeta(op.id, ctx?.profile ?? null, ctx?.meta)));
    } else {
      if (!globals.quiet && ctx?.meta.warnings.length)
        p.err(ctx.meta.warnings.map((w) => markerStyle.tone("warn", `! ${w}`)));
      const lines = [markerStyle.tone("bad", `✖ ${e.message}`)];
      if (e.hint) lines.push(...e.hint.split("\n").map((l) => markerStyle.dim(`  ${l}`)));
      p.err(lines);
    }
    return e.exit;
  }
}
