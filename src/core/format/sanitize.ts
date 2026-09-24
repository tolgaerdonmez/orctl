/**
 * API strings (key names, workspace names, model descriptions) are untrusted: a name containing
 * ESC sequences could rewrite the terminal. Everything user-visible passes through this.
 */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;

export function sanitizeTerminal(text: string): string {
  return text.replace(ANSI, "").replace(CONTROL, "");
}

/** Single-line variant for table cells: newlines and tabs become spaces. */
export function sanitizeCell(text: string): string {
  return sanitizeTerminal(text).replace(/[\t\n]+/g, " ");
}
