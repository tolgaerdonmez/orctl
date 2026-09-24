/**
 * SIGINT during a multi-step change (rotation) must stop at a step boundary rather than kill the
 * process mid-request (plan §8.1). While a guarded section runs, the CLI's SIGINT handler only
 * sets a flag; the executor checks it between steps and exits 130 with its journal left open.
 */
let guards = 0;
let requested = false;

export function interruptGuarded(): boolean {
  return guards > 0;
}

export function requestInterrupt(): void {
  requested = true;
}

export function interruptRequested(): boolean {
  return requested;
}

export async function guardInterrupts<T>(fn: () => Promise<T>): Promise<T> {
  guards++;
  try {
    return await fn();
  } finally {
    guards--;
    if (guards === 0) requested = false;
  }
}
