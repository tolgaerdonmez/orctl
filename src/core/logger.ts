import { inspect } from "node:util";
import { redact } from "./redact.ts";

/**
 * The logger handed to the SDK as `debugLogger` (plan §5.3 rule 2, §9 S1). The SDK only falls
 * back to `console` when OPENROUTER_DEBUG is set *and* no logger is given, so always passing
 * this one closes that path. When --debug is off it is a no-op; when on, every line is redacted
 * before it reaches stderr.
 */
export interface RedactingLogger {
  readonly enabled: boolean;
  group(label?: string): void;
  groupEnd(): void;
  log(message: unknown, ...args: unknown[]): void;
}

export type LineSink = (line: string) => void;

function render(value: unknown): string {
  if (typeof value === "string") return value;
  return inspect(value, { depth: 6, breakLength: 160, colors: false });
}

export function createLogger(enabled: boolean, sink: LineSink): RedactingLogger {
  let indent = 0;
  const write = (text: string) => {
    for (const line of redact(text).split("\n")) sink(`${"  ".repeat(indent)}${line}`);
  };
  return {
    enabled,
    group(label) {
      if (!enabled) return;
      if (label) write(`[orctl debug] ${label}`);
      indent++;
    },
    groupEnd() {
      if (!enabled) return;
      indent = Math.max(0, indent - 1);
    },
    log(message, ...args) {
      if (!enabled) return;
      write([message, ...args].map(render).join(" "));
    },
  };
}

export const silentLogger: RedactingLogger = createLogger(false, () => {});
