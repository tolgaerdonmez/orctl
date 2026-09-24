/**
 * An in-memory secret value. It refuses to serialize, stringify or inspect to its content, so a
 * stray console.log, JSON.stringify or template literal cannot leak it (plan §6.4, §9).
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  equals(other: Secret): boolean {
    return this.#value === other.#value;
  }

  get length(): number {
    return this.#value.length;
  }

  toString(): string {
    return "[secret]";
  }

  toJSON(): string {
    return "[secret]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[secret]";
  }
}

export function isSecret(value: unknown): value is Secret {
  return value instanceof Secret;
}

/** Plausible OpenRouter key shape; used before a key is ever handed to a subprocess. */
export const KEY_SHAPE = /^sk-or-[A-Za-z0-9_-]+$/;
