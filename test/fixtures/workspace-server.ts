import type { FakeFetcher, RecordedRequest } from "../fakes/fetcher.ts";
import { apiError, json } from "../fakes/fetcher.ts";
import { WS_DEFAULT, WS_PROD, WS_RESEARCH, workspace } from "./auth.ts";

type Raw = ReturnType<typeof workspace>;

/** Stateful fake of /workspaces, budgets and members (raw API shapes). */
export class WorkspaceServer {
  workspaces: Raw[] = [
    workspace(WS_DEFAULT, "default", "Default"),
    workspace(WS_RESEARCH, "research", "Research", { description: "ML experiments" }),
    workspace(WS_PROD, "prod", "Production"),
  ];
  budgets = new Map<string, Array<Record<string, unknown>>>([
    [
      WS_RESEARCH,
      [
        {
          id: "b1",
          limit_usd: 100,
          reset_interval: "monthly",
          workspace_id: WS_RESEARCH,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
    ],
  ]);
  members = new Map<string, Array<Record<string, unknown>>>([
    [
      WS_RESEARCH,
      [
        {
          id: "m1",
          user_id: "user_alice",
          role: "admin",
          workspace_id: WS_RESEARCH,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "m2",
          user_id: "user_bob",
          role: "member",
          workspace_id: WS_RESEARCH,
          created_at: "2026-02-01T00:00:00Z",
        },
      ],
    ],
  ]);

  constructor(f: FakeFetcher) {
    const find = (ref: string) => this.workspaces.find((w) => w.id === ref || w.slug === ref);
    const seg = (req: RecordedRequest, i: number) => decodeURIComponent(req.path.split("/")[i] ?? "");
    f.get("/workspaces", (req: RecordedRequest) => {
      const offset = Number(req.query.offset ?? 0);
      const limit = Number(req.query.limit ?? 50);
      return json({
        data: this.workspaces.slice(offset, offset + limit),
        total_count: this.workspaces.length,
      });
    })
      .on("POST", "/workspaces", (req: RecordedRequest) => {
        const body = req.json() as { name: string; slug: string; description?: string };
        if (find(body.slug)) return apiError(400, "slug taken");
        const w = workspace(
          `00000000-0000-4000-8000-00000000009${this.workspaces.length}`,
          body.slug,
          body.name,
          {
            description: body.description ?? null,
          },
        );
        this.workspaces.push(w);
        return json({ data: w }, 201);
      })
      .get(/^\/workspaces\/[^/]+$/, (req: RecordedRequest) => {
        const w = find(seg(req, 2));
        return w ? json({ data: w }) : apiError(404, "not found");
      })
      .on("PATCH", /^\/workspaces\/[^/]+$/, (req: RecordedRequest) => {
        const w = find(seg(req, 2));
        if (!w) return apiError(404, "not found");
        Object.assign(w, req.json());
        return json({ data: w });
      })
      .on("DELETE", /^\/workspaces\/[^/]+$/, (req: RecordedRequest) => {
        const w = find(seg(req, 2));
        if (!w) return apiError(404, "not found");
        this.workspaces = this.workspaces.filter((x) => x !== w);
        return json({ deleted: true });
      })
      .get(/^\/workspaces\/[^/]+\/members$/, (req: RecordedRequest) => {
        const w = find(seg(req, 2));
        const list = w ? (this.members.get(w.id) ?? []) : [];
        return json({ data: list, total_count: list.length });
      })
      .get(/^\/workspaces\/[^/]+\/budgets$/, (req: RecordedRequest) => {
        const w = find(seg(req, 2));
        if (!w) return apiError(404, "not found");
        return json({ data: this.budgets.get(w.id) ?? [], include_byok_in_budgets: false });
      })
      .on("PUT", /^\/workspaces\/[^/]+\/budgets\/[a-z]+$/, (req: RecordedRequest) => {
        const w = find(seg(req, 2));
        if (!w) return apiError(404, "not found");
        const interval = seg(req, 4);
        const body = req.json() as { limit_usd: number; include_byok_in_budgets?: boolean };
        const list = (this.budgets.get(w.id) ?? []).filter(
          (b) => (b.reset_interval ?? "lifetime") !== interval,
        );
        const b = {
          id: `b-${interval}`,
          limit_usd: body.limit_usd,
          reset_interval: interval === "lifetime" ? null : interval,
          workspace_id: w.id,
          created_at: "2026-09-24T12:00:00Z",
          updated_at: "2026-09-24T12:00:00Z",
        };
        list.push(b);
        this.budgets.set(w.id, list);
        return json({ data: b, include_byok_in_budgets: body.include_byok_in_budgets ?? false });
      })
      .on("DELETE", /^\/workspaces\/[^/]+\/budgets\/[a-z]+$/, (req: RecordedRequest) => {
        const w = find(seg(req, 2));
        if (!w) return apiError(404, "not found");
        const interval = seg(req, 4);
        this.budgets.set(
          w.id,
          (this.budgets.get(w.id) ?? []).filter((b) => (b.reset_interval ?? "lifetime") !== interval),
        );
        return json({ deleted: true });
      });
  }
}
