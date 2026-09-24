import type { Workspace } from "@openrouter/sdk/models";
import { mapError } from "../client/map-error.ts";
import { OrctlError } from "../errors.ts";
import { nearMatches } from "../format/suggest.ts";
import type { Ctx } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGES = 50;

export interface WorkspaceList {
  workspaces: Workspace[];
  /** False when the account cannot list workspaces; the list then holds only the default. */
  available: boolean;
}

/** All workspaces of the account, memoized for the run (plan §8.2). */
export function listWorkspaces(ctx: Ctx): Promise<WorkspaceList> {
  return ctx.memo("workspaces", async () => {
    try {
      const first = await ctx.sdk.management().workspaces.list({ limit: 100 });
      const all: Workspace[] = [];
      let pages = 0;
      for await (const page of first) {
        all.push(...page.result.data);
        if (++pages >= MAX_PAGES) break;
      }
      return { workspaces: all, available: true };
    } catch (err) {
      const e = mapError(err);
      if (e.code === "AUTH" || e.code === "NOT_FOUND") return { workspaces: [], available: false };
      throw e;
    }
  });
}

/** Workspace reference: id (UUID), then slug, then name (plan §7.4). */
export async function resolveWorkspace(ctx: Ctx, ref: string): Promise<Workspace> {
  const { workspaces, available } = await listWorkspaces(ctx);
  const byId = workspaces.find((w) => w.id === ref);
  if (byId) return byId;
  const bySlug = workspaces.find((w) => w.slug === ref);
  if (bySlug) return bySlug;
  const byName = workspaces.filter((w) => w.name === ref);
  if (byName.length === 1 && byName[0]) return byName[0];
  if (byName.length > 1) {
    throw new OrctlError("USAGE", `Workspace name "${ref}" is ambiguous.`, {
      hint: `Use the slug or id: ${byName.map((w) => `${w.slug} (${w.id})`).join(", ")}`,
    });
  }
  if (!available && UUID.test(ref)) {
    // Cannot list workspaces; trust an explicit id.
    return { id: ref, slug: ref, name: ref } as Workspace;
  }
  const similar = nearMatches(
    ref,
    workspaces.map((w) => w.slug),
  );
  throw new OrctlError("NOT_FOUND", `Workspace "${ref}" was not found.`, {
    hint: similar.length ? `Did you mean: ${similar.join(", ")}?` : "List them with `orctl workspaces list`.",
  });
}

export function workspaceLabel(w: Pick<Workspace, "slug" | "name"> | undefined): string {
  return w ? w.slug : "?";
}
