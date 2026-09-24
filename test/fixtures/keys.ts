import type { FakeFetcher, RecordedRequest } from "../fakes/fetcher.ts";
import { apiError, json } from "../fakes/fetcher.ts";
import { apiKey, credits, hash, WS_DEFAULT, WS_PROD, WS_RESEARCH, workspaces } from "./auth.ts";

export const LAPTOP_HASH = `${hash("laptop").slice(0, 60)}1c96`;

/** A small account: three workspaces with keys, including a disabled and an expiring one. */
export const KEYS = {
  [WS_DEFAULT]: [
    apiKey("ci-bot", { limit: 50, limit_remaining: 5, limit_reset: "monthly", usage: 45, usage_monthly: 45 }),
    apiKey("laptop", {
      hash: LAPTOP_HASH,
      usage: 3.2,
      usage_monthly: 1.1,
      expires_at: "2026-10-01T00:00:00Z",
    }),
    apiKey("old", { disabled: true }),
  ],
  [WS_RESEARCH]: [
    apiKey("notebook", { workspace_id: WS_RESEARCH, hash: `abc123${"0".repeat(58)}` }),
    apiKey("ci-bot", { workspace_id: WS_RESEARCH, hash: hash("ci-bot-research") }),
  ],
  [WS_PROD]: [
    apiKey("api-server", { workspace_id: WS_PROD, limit: 100, limit_remaining: 90, usage_monthly: 10 }),
  ],
} as const;

/** Serves GET /keys with workspace_id / offset / include_disabled semantics, 2 keys per page. */
export function serveKeys(f: FakeFetcher, opts: { failWorkspace?: string; pageSize?: number } = {}): void {
  const size = opts.pageSize ?? 2;
  f.get("/credits", credits())
    .get("/workspaces", workspaces())
    .get("/keys", (req: RecordedRequest) => {
      const ws = req.query.workspace_id ?? WS_DEFAULT;
      if (ws === opts.failWorkspace) return apiError(500, "boom");
      const all = (KEYS[ws as keyof typeof KEYS] ?? []).filter(
        (k) => req.query.include_disabled === "true" || !k.disabled,
      );
      const offset = Number(req.query.offset ?? 0);
      return json({ data: all.slice(offset, offset + size) });
    })
    .get(/^\/keys\/[0-9a-f]{64}$/, (req: RecordedRequest) => {
      const h = req.path.split("/").pop();
      const k = Object.values(KEYS)
        .flat()
        .find((x) => x.hash === h);
      return k ? json({ data: k }) : apiError(404, "not found");
    });
}
