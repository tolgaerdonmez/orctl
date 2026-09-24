/**
 * Error taxonomy and exit codes (plan §5.4). Every failure that reaches a user surface is an
 * OrctlError; SDK errors are translated by client/map-error.ts and never serialized raw.
 */

export const ExitCode = {
  OK: 0,
  USAGE: 2,
  NO_CREDENTIAL: 3,
  AUTH: 4,
  NOT_FOUND: 5,
  PAYMENT: 6,
  RATE_LIMIT: 7,
  SERVER: 8,
  UNEXPECTED: 9,
  NETWORK: 10,
  PARTIAL: 11,
  UNKNOWN_OUTCOME: 12,
  INTERRUPTED: 130,
} as const;

export type ErrorCode = Exclude<keyof typeof ExitCode, "OK">;

export interface OrctlErrorOptions {
  hint?: string | undefined;
  httpStatus?: number | undefined;
  cause?: unknown;
  /** Extra structured, secret-free detail for --json output (e.g. ambiguous candidates). */
  details?: unknown;
}

export class OrctlError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly httpStatus: number | undefined;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, options: OrctlErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OrctlError";
    this.code = code;
    this.hint = options.hint;
    this.httpStatus = options.httpStatus;
    this.details = options.details;
  }

  get exit(): number {
    return ExitCode[this.code];
  }

  toJSON(): OrctlErrorJson {
    const out: OrctlErrorJson = {
      code: this.code,
      exit: this.exit,
      message: this.message,
      hint: this.hint ?? null,
      http_status: this.httpStatus ?? null,
    };
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

export interface OrctlErrorJson {
  code: ErrorCode;
  exit: number;
  message: string;
  hint: string | null;
  http_status: number | null;
  details?: unknown;
}

export function errorFromJson(json: OrctlErrorJson, prefix = ""): OrctlError {
  return new OrctlError(json.code, `${prefix}${json.message}`, {
    hint: json.hint ?? undefined,
    httpStatus: json.http_status ?? undefined,
    details: json.details,
  });
}

export function usageError(message: string, hint?: string): OrctlError {
  return new OrctlError("USAGE", message, { hint });
}

export function isOrctlError(err: unknown): err is OrctlError {
  return err instanceof OrctlError;
}
