import type { FakeFetcher, RecordedRequest } from "../fakes/fetcher.ts";
import { apiError, json } from "../fakes/fetcher.ts";
import { FAKE_NEW_KEY } from "../fakes/keys.ts";
import { apiKey, credits, currentKey, WS_DEFAULT, workspaces } from "./auth.ts";

type Raw = ReturnType<typeof apiKey>;
type Failure = { status: number } | "network" | "network-after-create";

/**
 * Stateful fake of the /keys API: create (201 + one-time plaintext), list, get, update, delete.
 * `fail(method, pathPrefix, failure)` injects the next failure for a route, including a network
 * error after the server already created the key (the "unknown outcome" case).
 */
export class KeyServer {
  keys: Raw[] = [];
  created: Array<{ hash: string; key: string }> = [];
  #failures: Array<{ method: string; path: string; failure: Failure }> = [];
  #seq = 0;
  /** Plaintext of each created key, by hash, as the user would receive it. */
  secrets = new Map<string, string>();

  constructor(
    f: FakeFetcher,
    private readonly now: () => Date,
  ) {
    f.get("/credits", credits())
      .get("/workspaces", workspaces())
      .get("/key", (req: RecordedRequest) => {
        const bearer = req.headers.authorization?.replace("Bearer ", "");
        const hit = [...this.secrets.entries()].find(([, v]) => v === bearer);
        if (!hit) return currentKey();
        const k = this.keys.find((x) => x.hash === hit[0]);
        return k?.disabled ? apiError(401, "key disabled") : currentKey({ label: k?.label ?? "?" });
      })
      .get("/keys", (req: RecordedRequest) => {
        const ws = req.query.workspace_id ?? WS_DEFAULT;
        const all = this.keys.filter(
          (k) => k.workspace_id === ws && (req.query.include_disabled === "true" || !k.disabled),
        );
        const offset = Number(req.query.offset ?? 0);
        return json({ data: all.slice(offset, offset + 50) });
      })
      .on("POST", "/keys", (req: RecordedRequest) => this.#create(req))
      .get(/^\/keys\/[0-9a-f]{64}$/, (req: RecordedRequest) => {
        const k = this.#find(req);
        return k ? json({ data: k }) : apiError(404, "not found");
      })
      .on("PATCH", /^\/keys\/[0-9a-f]{64}$/, (req: RecordedRequest) => this.#update(req))
      .on("DELETE", /^\/keys\/[0-9a-f]{64}$/, (req: RecordedRequest) => this.#delete(req));
  }

  add(name: string, over: Record<string, unknown> = {}): Raw {
    const k = apiKey(name, over);
    this.keys.push(k);
    return k;
  }

  fail(method: string, path: string, failure: Failure): this {
    this.#failures.push({ method, path, failure });
    return this;
  }

  byName(name: string): Raw[] {
    return this.keys.filter((k) => k.name === name);
  }

  #take(req: RecordedRequest): Failure | undefined {
    const i = this.#failures.findIndex((x) => x.method === req.method && req.path.startsWith(x.path));
    if (i < 0) return undefined;
    const [f] = this.#failures.splice(i, 1);
    return f?.failure;
  }

  #find(req: RecordedRequest): Raw | undefined {
    const h = req.path.split("/").pop();
    return this.keys.find((k) => k.hash === h);
  }

  #create(req: RecordedRequest): Response {
    const failure = this.#take(req);
    if (failure === "network") throw new TypeError("fetch failed");
    if (failure && failure !== "network-after-create") return apiError(failure.status, "injected failure");
    const body = req.json() as Record<string, unknown>;
    const n = ++this.#seq;
    const hash =
      `${n.toString(16).padStart(4, "0")}${"f".repeat(56)}${(1000 + n).toString(16).padStart(4, "0")}`.slice(
        0,
        64,
      );
    const key = `${FAKE_NEW_KEY.slice(0, -4)}${(1000 + n).toString(16).padStart(4, "0")}`;
    const k = apiKey(String(body.name), {
      hash,
      limit: body.limit ?? null,
      limit_remaining: body.limit ?? null,
      limit_reset: body.limit_reset ?? null,
      include_byok_in_limit: body.include_byok_in_limit ?? false,
      expires_at: body.expires_at ?? null,
      workspace_id: body.workspace_id ?? WS_DEFAULT,
      created_at: this.now().toISOString(),
    });
    this.keys.push(k);
    this.created.push({ hash, key });
    this.secrets.set(hash, key);
    if (failure === "network-after-create") throw new TypeError("fetch failed");
    return json({ data: k, key }, 201);
  }

  #update(req: RecordedRequest): Response {
    const failure = this.#take(req);
    if (failure === "network") throw new TypeError("fetch failed");
    if (failure && failure !== "network-after-create") return apiError(failure.status, "injected failure");
    const k = this.#find(req);
    if (!k) return apiError(404, "not found");
    const body = req.json() as Record<string, unknown>;
    Object.assign(k, body, body.limit !== undefined ? { limit_remaining: body.limit } : {});
    return json({ data: k });
  }

  #delete(req: RecordedRequest): Response {
    const failure = this.#take(req);
    if (failure === "network") throw new TypeError("fetch failed");
    if (failure && failure !== "network-after-create") return apiError(failure.status, "injected failure");
    const k = this.#find(req);
    if (!k) return apiError(404, "not found");
    this.keys = this.keys.filter((x) => x !== k);
    return json({ deleted: true });
  }
}
