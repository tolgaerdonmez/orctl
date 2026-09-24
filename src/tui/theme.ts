import type { Tone } from "../core/format/columns.ts";

/** TUI palette. The profile color drives the header badge and frame accent (plan §5.6, §6.10). */
export const theme = {
  fg: "#e5e7eb",
  muted: "#8b93a1",
  dim: "#5b6270",
  accent: "#7aa2f7",
  good: "#4ade80",
  warn: "#facc15",
  bad: "#f87171",
  border: "#3b4252",
  selectionBg: "#263244",
  selectionFg: "#ffffff",
  modalBg: "#161b22",
  headerBg: "#11151c",
} as const;

export const PROFILE_HEX: Record<string, string> = {
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#e879f9",
  cyan: "#22d3ee",
  white: "#e5e7eb",
  gray: "#9ca3af",
};

export function profileHex(color: string | null | undefined): string {
  return (color && PROFILE_HEX[color]) || theme.accent;
}

export function toneHex(tone: Tone | undefined): string | undefined {
  switch (tone) {
    case "good":
      return theme.good;
    case "warn":
      return theme.warn;
    case "bad":
      return theme.bad;
    case "muted":
      return theme.muted;
    case "accent":
      return theme.accent;
    default:
      return undefined;
  }
}
