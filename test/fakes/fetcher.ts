import type { Fetcher } from "@openrouter/sdk";

/**
 * HTTP-level fake for the SDK (plan §10): the real SDK builds requests and parses responses with
 * its zod schemas, so schema drift in fixtures surfaces as ResponseValidationError in tests.
 */
export interface RecordedRequest {
  method: string;
  url: URL;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  json(): unknown;
}

export type Handler = (req: RecordedRequest) => Response | Promise<Response>;

interface Route {
  method: string;
  path: string | RegExp;
  handler: Handler;
  times?: number;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function apiError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return json({ error: { code: status, message } }, status, headers);
}

export const API_PREFIX = "/api/v1";

export class FakeFetcher {
  readonly calls: RecordedRequest[] = [];
  readonly #routes: Route[] = [];

  on(
    method: string,
    path: string | RegExp,
    handler: Handler | unknown,
    opts: { status?: number; times?: number } = {},
  ): this {
    const h: Handler =
      typeof handler === "function" ? (handler as Handler) : () => json(handler, opts.status ?? 200);
    this.#routes.unshift({ method: method.toUpperCase(), path, handler: h, times: opts.times });
    return this;
  }

  get(path: string | RegExp, handler: Handler | unknown, opts?: { status?: number; times?: number }): this {
    return this.on("GET", path, handler, opts);
  }

  callsTo(method: string, path: string | RegExp): RecordedRequest[] {
    return this.calls.filter(
      (c) =>
        c.method === method.toUpperCase() && (typeof path === "string" ? c.path === path : path.test(c.path)),
    );
  }

  readonly fetcher: Fetcher = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = request.body ? await request.clone().text() : "";
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname;
    const recorded: RecordedRequest = {
      method: request.method.toUpperCase(),
      url,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body,
      json: () => JSON.parse(body),
    };
    this.calls.push(recorded);
    const route = this.#routes.find(
      (r) =>
        r.method === recorded.method &&
        (typeof r.path === "string" ? r.path === path : r.path.test(path)) &&
        (r.times === undefined || r.times > 0),
    );
    if (!route) return apiError(404, `no fake route for ${recorded.method} ${path}`);
    if (route.times !== undefined) route.times--;
    return route.handler(recorded);
  };
}
