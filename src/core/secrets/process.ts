/**
 * Subprocess seam for secret backends (`security`, `op`). Every call runs with piped stdio; the
 * argv never carries a secret (plan §6.4, §9 S4). Tests substitute a fake runner.
 */
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProcessOptions {
  stdin?: string | undefined;
  timeoutMs?: number | undefined;
}

export type ProcessRunner = (argv: readonly string[], options?: ProcessOptions) => Promise<ProcessResult>;

export const bunProcessRunner: ProcessRunner = async (argv, options = {}) => {
  const proc = Bun.spawn([...argv], {
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined && proc.stdin) {
    proc.stdin.write(options.stdin);
    await proc.stdin.end();
  }
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => proc.kill(), Math.max(1, options.timeoutMs));
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export type WhichFn = (bin: string) => string | null;

export const bunWhich: WhichFn = (bin) => Bun.which(bin);
