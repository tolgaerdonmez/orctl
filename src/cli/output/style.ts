import type { Tone } from "../../core/format/columns.ts";
import { sanitizeTerminal } from "../../core/format/sanitize.ts";
import type { Style } from "../../core/format/view.ts";

/**
 * Views style text through private-use markers. The final line is sanitized first (untrusted API
 * text loses any escape sequences) and only then are the markers turned into our own SGR codes,
 * so data can never inject terminal control sequences.
 */
const OPEN = "";
const SEP = "";
const CLOSE = "";
const MARKER_OPEN = /[a-z]*/g;
const MARKERS = /[-]/g;

const CODES: Record<string, readonly [number, number]> = {
  bold: [1, 22],
  dim: [2, 22],
  muted: [2, 22],
  good: [32, 39],
  warn: [33, 39],
  bad: [31, 39],
  accent: [36, 39],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  white: [37, 39],
  gray: [90, 39],
};

const mark = (code: string, s: string) => `${OPEN}${code}${SEP}${s}${CLOSE}`;

export const markerStyle: Style = {
  bold: (s) => mark("bold", s),
  dim: (s) => mark("dim", s),
  tone: (t: Tone, s) => mark(t, s),
  color: (c, s) => (c && c in CODES ? mark(c, s) : s),
};

export function stripMarkers(text: string): string {
  return text.replace(MARKER_OPEN, "").replace(MARKERS, "");
}

/** Removes untrusted control characters, then applies (or strips) our styling markers. */
export function finalize(text: string, color: boolean): string {
  const clean = sanitizeTerminal(text);
  if (!color) return stripMarkers(clean);
  const stack: string[] = [];
  let out = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i] as string;
    if (ch === OPEN) {
      const sep = clean.indexOf(SEP, i);
      const name = sep > i ? clean.slice(i + 1, sep) : "";
      const code = CODES[name];
      if (code) {
        out += `\u001b[${code[0]}m`;
        stack.push(name);
        i = sep;
      }
      continue;
    }
    if (ch === CLOSE) {
      const name = stack.pop();
      const code = name ? CODES[name] : undefined;
      if (code) {
        out += `\u001b[${code[1]}m`;
        // a shared reset code (22 for bold/dim, 39 for colors) also ends outer styles: reopen them
        for (const outer of stack) {
          const o = CODES[outer];
          if (o && o[1] === code[1]) out += `\u001b[${o[0]}m`;
        }
      }
      continue;
    }
    if (ch === SEP) continue;
    out += ch;
  }
  return out;
}

/** Visible terminal width, ignoring our markers. */
export function visibleWidth(text: string): number {
  return Bun.stringWidth(stripMarkers(text));
}
