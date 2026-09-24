import { type Fetcher, HTTPClient, OpenRouter } from "@openrouter/sdk";
import type { RequestOptions } from "@openrouter/sdk/lib/sdks.js";
import type { RedactingLogger } from "../logger.ts";
import { OPENROUTER_API_URL, USER_AGENT } from "../version.ts";

export type ApiRole = "public" | "user" | "management";

/** Response headers kept for 429 messages (plan §5.3 rule 5). */
export interface RateLimitInfo {
  retryAfter?: string | undefined;
  limit?: string | undefined;
  remaining?: string | undefined;
  reset?: string | undefined;
}

export interface ClientOptions {
  fetcher?: Fetcher | undefined;
  timeoutMs: number;
  log: RedactingLogger;
  rateLimit: RateLimitInfo;
}

/** Reads retry briefly; the SDK default for some calls retries for up to an hour. */
export const READ_RETRY = {
  strategy: "backoff",
  backoff: { initialInterval: 500, maxInterval: 4000, exponent: 1.5, maxElapsedTime: 15_000 },
  retryConnectionErrors: true,
} as const;

/**
 * Per-call options for every mutation (plan §5.3 rule 3, §9 S3). apiKeys.create otherwise
 * retries 5XX and connection errors with backoff for up to an hour, which can create duplicate
 * keys or orphans whose plaintext is lost.
 */
export const MUTATION: RequestOptions = { retries: { strategy: "none" } };

export class PublicCredentialError extends Error {
  constructor() {
    super("orctl refused to send credentials on a public request");
    this.name = "PublicCredentialError";
  }
}

/**
 * Builds an OpenRouter SDK instance for one role. The SDK traps from plan Ek A-3 are closed here:
 *  - apiKey is always explicit: "" for public calls, so the SDK never falls back to
 *    OPENROUTER_API_KEY (an empty value adds no Authorization header);
 *  - debugLogger is always set, so OPENROUTER_DEBUG can never route headers/bodies to console;
 *  - serverURL is always explicit, so OPENROUTER_BASE_URL cannot redirect a management key;
 *  - mutations pass MUTATION (no retries).
 */
export function createClient(
  role: ApiRole,
  apiKey: string | (() => Promise<string>),
  options: ClientOptions,
): OpenRouter {
  const baseFetcher: Fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const httpClient = new HTTPClient({ fetcher: baseFetcher });
  httpClient.addHook("beforeRequest", (req) => {
    const headers = new Headers(req.headers);
    headers.set("user-agent", USER_AGENT);
    if (role === "public" && headers.has("authorization")) throw new PublicCredentialError();
    return new Request(req, { headers });
  });
  httpClient.addHook("response", (res) => {
    const h = res.headers;
    if (res.status === 429 || h.has("retry-after")) {
      options.rateLimit.retryAfter = h.get("retry-after") ?? undefined;
      options.rateLimit.limit = h.get("x-ratelimit-limit") ?? undefined;
      options.rateLimit.remaining = h.get("x-ratelimit-remaining") ?? undefined;
      options.rateLimit.reset = h.get("x-ratelimit-reset") ?? undefined;
    }
  });
  return new OpenRouter({
    apiKey,
    httpClient,
    serverURL: OPENROUTER_API_URL,
    retryConfig: READ_RETRY,
    timeoutMs: options.timeoutMs,
    debugLogger: options.log,
  });
}
