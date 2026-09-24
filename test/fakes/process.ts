import type { ProcessOptions, ProcessResult, ProcessRunner } from "../../src/core/secrets/process.ts";

export interface SpawnRecord {
  argv: string[];
  stdin?: string | undefined;
}

/** Scripted subprocess runner; records every argv/stdin so tests can assert secrets stay off argv. */
export function fakeRunner(
  handler: (argv: string[], opts: ProcessOptions) => ProcessResult | Promise<ProcessResult>,
) {
  const calls: SpawnRecord[] = [];
  const run: ProcessRunner = async (argv, opts = {}) => {
    calls.push({ argv: [...argv], stdin: opts.stdin });
    return handler([...argv], opts);
  };
  return { run, calls };
}

export const ok = (stdout = ""): ProcessResult => ({ code: 0, stdout, stderr: "" });
export const fail = (code: number, stderr = ""): ProcessResult => ({ code, stdout: "", stderr });
