import { isSecret } from "../core/secret.ts";
import { type CommandSpec, longFlag, specFor } from "./spec.ts";

const SAFE = /^[A-Za-z0-9_./:@%+=,-]+$/;

/** POSIX shell quoting for display; single quotes unless the word is already safe. */
export function shellQuote(word: string): string {
  if (word === "") return "''";
  if (SAFE.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

function formatValue(spec: CommandSpec["flags"][number], value: unknown): string {
  if (spec.format) return spec.format(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * The CLI command equivalent to an operation input (plan §5.2): shown in the TUI footer and
 * palette, and round-tripped by the parity test. Secrets are never rendered; a secret field
 * becomes its `--…-stdin` flag.
 */
export function formatCli(
  op: string,
  input: Record<string, unknown>,
  options: { profile?: string | undefined; bin?: string } = {},
): string {
  const spec = specFor(op);
  if (!spec) throw new Error(`no CLI spec for ${op}`);
  const words: string[] = [options.bin ?? "orctl", ...spec.path];
  for (const pos of spec.positionals) {
    const v = input[pos.field];
    if (v === undefined || v === null) continue;
    words.push(shellQuote(String(v)));
  }
  for (const flag of spec.flags) {
    const v = input[flag.field];
    if (v === undefined) continue;
    const name = longFlag(flag.flags);
    switch (flag.type) {
      case "boolean":
        if (v === true) words.push(name);
        break;
      case "negatable":
        if (v === false) words.push(name);
        break;
      case "stdin-secret":
        if (isSecret(v)) words.push(name);
        break;
      case "optional-string":
        if (v === true) words.push(name);
        else if (typeof v === "string") words.push(name, shellQuote(v));
        break;
      default:
        if (v === null && !flag.format) break;
        words.push(name, shellQuote(formatValue(flag, v)));
    }
  }
  if (options.profile) words.push("-p", shellQuote(options.profile));
  return words.join(" ");
}

/** Splits a command line produced by formatCli back into argv (single quotes and plain words). */
export function splitShellWords(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (ch === "'") {
      inWord = true;
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error("unterminated quote");
      cur += line.slice(i + 1, end);
      i = end;
    } else if (ch === "\\" && i + 1 < line.length) {
      inWord = true;
      cur += line[++i];
    } else if (/\s/.test(ch)) {
      if (inWord) out.push(cur);
      cur = "";
      inWord = false;
    } else {
      inWord = true;
      cur += ch;
    }
  }
  if (inWord) out.push(cur);
  return out;
}
