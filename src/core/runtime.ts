/** Small runtime primitives shared by every layer: clock, concurrency limiter, timeouts. */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** A FIFO concurrency limiter (plan §5.3: at most 4 concurrent API requests). */
export function createLimiter(concurrency: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency) return;
    const start = queue.shift();
    if (start) {
      active++;
      start();
    }
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolvePromise, reject) => {
      queue.push(() => {
        fn()
          .then(resolvePromise, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

export async function mapLimit<T, R>(items: readonly T[], limiter: Limiter, fn: (item: T) => Promise<R>) {
  return Promise.allSettled(items.map((item) => limiter(() => fn(item))));
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
