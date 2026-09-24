import {
  ConnectionError,
  ForbiddenResponseError,
  NotFoundResponseError,
  OpenRouterError,
  PaymentRequiredResponseError,
  RequestAbortedError,
  RequestTimeoutError,
  ResponseValidationError,
  SDKValidationError,
  TooManyRequestsResponseError,
  UnauthorizedResponseError,
} from "@openrouter/sdk/models/errors";
import { type ErrorCode, OrctlError } from "../errors.ts";
import { messages } from "../messages.ts";
import { redact } from "../redact.ts";
import { TimeoutError } from "../runtime.ts";
import { ORCTL_VERSION } from "../version.ts";
import { PublicCredentialError, type RateLimitInfo } from "./factory.ts";

/** Short, redacted summary of an error body; the raw Response and headers are never kept (§5.4). */
function bodySummary(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const msg = parsed?.error?.message;
    if (typeof msg === "string" && msg) return redact(msg).slice(0, 300);
  } catch {
    // not JSON; fall through
  }
  return redact(body).replace(/\s+/g, " ").slice(0, 200);
}

export interface MapErrorContext {
  rateLimit?: RateLimitInfo | undefined;
  /** The operation was a mutation: a network failure means the outcome is unknown (exit 12). */
  mutation?: boolean | undefined;
  role?: "public" | "user" | "management" | undefined;
  profile?: string | undefined;
}

export function mapError(err: unknown, ctx: MapErrorContext = {}): OrctlError {
  if (err instanceof OrctlError) return err;
  if (err instanceof PublicCredentialError) return new OrctlError("UNEXPECTED", err.message);

  if (
    err instanceof ConnectionError ||
    err instanceof RequestTimeoutError ||
    err instanceof RequestAbortedError ||
    err instanceof TimeoutError
  ) {
    const detail = redact(err.message);
    if (ctx.mutation) {
      return new OrctlError("UNKNOWN_OUTCOME", `${messages.unknownOutcome} (${detail})`, { cause: err });
    }
    return new OrctlError("NETWORK", `Network error: ${detail}`, { hint: messages.networkHint, cause: err });
  }

  // An error status whose body did not match the SDK's error schema is still that status.
  // (SDKValidationError has a duck-typed Symbol.hasInstance that also matches these.)
  const errorStatus = err instanceof OpenRouterError && err.statusCode >= 400;
  if (!errorStatus && (err instanceof ResponseValidationError || err instanceof SDKValidationError)) {
    return new OrctlError("UNEXPECTED", `Unexpected response shape: ${redact(err.message).slice(0, 300)}`, {
      hint: messages.unexpectedHint(ORCTL_VERSION),
    });
  }

  if (err instanceof OpenRouterError) {
    const status = err.statusCode;
    const summary = bodySummary(err.body);
    const message = summary ? `OpenRouter ${status}: ${summary}` : `OpenRouter returned HTTP ${status}.`;
    const make = (code: ErrorCode, hint?: string) =>
      new OrctlError(code, message, { hint, httpStatus: status });
    if (
      err instanceof UnauthorizedResponseError ||
      err instanceof ForbiddenResponseError ||
      status === 401 ||
      status === 403
    ) {
      const hint =
        ctx.role === "management" && ctx.profile
          ? `${messages.wrongRoleForCommand(ctx.profile)} ${status === 403 ? messages.connectKeyHint : ""}`.trim()
          : status === 403
            ? messages.connectKeyHint
            : undefined;
      return make("AUTH", hint);
    }
    if (err instanceof NotFoundResponseError || status === 404) return make("NOT_FOUND");
    if (err instanceof PaymentRequiredResponseError || status === 402)
      return make("PAYMENT", messages.paymentHint);
    if (err instanceof TooManyRequestsResponseError || status === 429) {
      return make("RATE_LIMIT", messages.rateLimitHint(ctx.rateLimit?.retryAfter));
    }
    if (status >= 500) return make("SERVER", messages.serverHint);
    if (status === 400 || status === 422) return make("USAGE");
    return make("UNEXPECTED");
  }

  const message = err instanceof Error ? err.message : String(err);
  return new OrctlError("UNEXPECTED", redact(message));
}
