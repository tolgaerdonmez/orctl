import type { ListData } from "@openrouter/sdk/models/operations";
import { z } from "zod";
import { mapError } from "../client/map-error.ts";
import { OrctlError } from "../errors.ts";
import { nearMatches } from "../format/suggest.ts";
import { toDate } from "../format/time.ts";
import { mapLimit } from "../runtime.ts";
import { type Ctx, defineOp } from "./types.ts";
import { listWorkspaces, resolveWorkspace } from "./workspace-ref.ts";

/**
 * API keys across workspaces (plan §8.2). GET /keys returns only the default workspace unless a
 * workspace_id is given, so orctl walks every workspace by default instead of silently showing a
 * partial list. /keys is not a PageIterator in the SDK: pages are fetched by offset until empty.
 */
export type KeyItem = ListData & {
  workspaceSlug: string;
  workspaceName: string;
};

const MAX_KEY_PAGES = 50;
export const KEY_SORTS = ["workspace", "name", "usage", "created", "expires"] as const;

async function listKeysIn(
  ctx: Ctx,
  workspaceId: string | undefined,
  includeDisabled: boolean,
): Promise<ListData[]> {
  const out: ListData[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_KEY_PAGES; page++) {
    const res = await ctx.sdk.management().apiKeys.list({
      includeDisabled,
      offset: offset || undefined,
      ...(workspaceId ? { workspaceId } : {}),
    });
    if (res.data.length === 0) break;
    out.push(...res.data);
    offset += res.data.length;
  }
  return out;
}

export interface KeysResult {
  keys: KeyItem[];
  workspaces: number;
  partial: string[];
}

/** Every key of the account (or one workspace), deduplicated by hash, memoized for the run. */
export function listAllKeys(
  ctx: Ctx,
  opts: { workspace?: string | undefined; includeDisabled: boolean },
): Promise<KeysResult> {
  return ctx.memo(`keys:${opts.workspace ?? "*"}:${opts.includeDisabled}`, async () => {
    const { workspaces, available } = await listWorkspaces(ctx);
    let targets: Array<{ id: string | undefined; slug: string; name: string }>;
    if (opts.workspace) {
      const w = await resolveWorkspace(ctx, opts.workspace);
      targets = [{ id: w.id, slug: w.slug, name: w.name }];
    } else if (available && workspaces.length > 0) {
      targets = workspaces.map((w) => ({ id: w.id, slug: w.slug, name: w.name }));
    } else {
      targets = [{ id: undefined, slug: "default", name: "Default" }];
      if (!available)
        ctx.meta.warnings.push(
          "Workspaces are not available to this key; showing the default workspace only.",
        );
    }
    const results = await mapLimit(targets, ctx.limiter, (t) => listKeysIn(ctx, t.id, opts.includeDisabled));
    const seen = new Set<string>();
    const keys: KeyItem[] = [];
    const partial: string[] = [];
    results.forEach((r, i) => {
      const t = targets[i];
      if (!t) return;
      if (r.status === "rejected") {
        partial.push(t.slug);
        ctx.meta.warnings.push(`Workspace ${t.slug}: ${mapError(r.reason).message}`);
        return;
      }
      for (const k of r.value) {
        if (seen.has(k.hash)) continue;
        seen.add(k.hash);
        const ws = workspaces.find((w) => w.id === k.workspaceId);
        keys.push({ ...k, workspaceSlug: ws?.slug ?? t.slug, workspaceName: ws?.name ?? t.name });
      }
    });
    if (partial.length === targets.length && results[0]?.status === "rejected")
      throw mapError(results[0].reason);
    ctx.meta.partial.push(...partial);
    ctx.meta.workspaces = targets.length;
    return { keys, workspaces: targets.length, partial };
  });
}

export function sortKeys(keys: KeyItem[], sort: (typeof KEY_SORTS)[number] = "workspace"): KeyItem[] {
  const byName = (a: KeyItem, b: KeyItem) => a.name.localeCompare(b.name);
  const time = (v: unknown) => toDate(v as string)?.getTime() ?? Number.POSITIVE_INFINITY;
  const cmp: Record<string, (a: KeyItem, b: KeyItem) => number> = {
    workspace: (a, b) => a.workspaceSlug.localeCompare(b.workspaceSlug) || byName(a, b),
    name: byName,
    usage: (a, b) => b.usage - a.usage || byName(a, b),
    created: (a, b) => time(b.createdAt) - time(a.createdAt),
    expires: (a, b) => time(a.expiresAt) - time(b.expiresAt) || byName(a, b),
  };
  return [...keys].sort(cmp[sort]);
}

/** The server's masked label ends with the last four characters, e.g. "sk-or-v1-0e6...1c96". */
function labelSuffix(label: string): string {
  const m = label.match(/([A-Za-z0-9]{2,})$/);
  return m?.[1] ?? label;
}

export function describeKey(k: Pick<KeyItem, "name" | "label" | "workspaceSlug">): string {
  return `${k.name} (…${labelSuffix(k.label)}, ${k.workspaceSlug})`;
}

/**
 * Key reference resolution (plan §7.4): full 64-hex hash → hash prefix (≥6 hex, unique) →
 * exact name → label suffix (…1c96). Ambiguity is a usage error listing the candidates.
 */
export async function resolveKey(ctx: Ctx, ref: string, workspace?: string): Promise<KeyItem> {
  const r = ref.trim();
  const { keys } = await listAllKeys(ctx, { workspace, includeDisabled: true });
  const pick = (candidates: KeyItem[], kind: string): KeyItem | undefined => {
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      throw new OrctlError("USAGE", `Key ${kind} "${r}" matches ${candidates.length} keys.`, {
        hint: `Use a longer hash prefix. Candidates: ${candidates.map((k) => `${describeKey(k)} ${k.hash.slice(0, 10)}`).join("; ")}`,
        details: {
          candidates: candidates.map((k) => ({
            hash: k.hash,
            name: k.name,
            label: k.label,
            workspace: k.workspaceSlug,
          })),
        },
      });
    }
    return undefined;
  };
  if (/^[0-9a-f]{64}$/i.test(r)) {
    const hit = keys.find((k) => k.hash === r.toLowerCase());
    if (hit) return hit;
    const res = await ctx.sdk.management().apiKeys.get({ hash: r.toLowerCase() });
    return { ...res.data, workspaceSlug: "?", workspaceName: "?" };
  }
  if (/^[0-9a-f]{6,63}$/i.test(r)) {
    const hit = pick(
      keys.filter((k) => k.hash.startsWith(r.toLowerCase())),
      "hash prefix",
    );
    if (hit) return hit;
  }
  const byName = pick(
    keys.filter((k) => k.name === r),
    "name",
  );
  if (byName) return byName;
  const suffix = r.replace(/^(…|\.\.\.|\.\.|sk-or-[a-z0-9]*-?[a-z0-9]*\.\.\.)/i, "");
  if (suffix.length >= 3) {
    const byLabel = pick(
      keys.filter((k) => labelSuffix(k.label).endsWith(suffix)),
      "label",
    );
    if (byLabel) return byLabel;
  }
  const similar = nearMatches(
    r,
    keys.map((k) => k.name),
  );
  throw new OrctlError("NOT_FOUND", `No key matches "${r}".`, {
    hint: similar.length
      ? `Did you mean: ${similar.join(", ")}?`
      : "List keys with `orctl keys list --include-disabled`.",
  });
}

export const keysList = defineOp({
  id: "keys.list",
  role: "management",
  kind: "read",
  summary: "List API keys across all workspaces",
  input: z.object({
    workspace: z.string().optional(),
    includeDisabled: z.boolean().optional(),
    sort: z.enum(KEY_SORTS).optional(),
    strict: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const res = await listAllKeys(ctx, {
      workspace: input.workspace,
      includeDisabled: Boolean(input.includeDisabled),
    });
    if (input.strict && res.partial.length) ctx.meta.exit = 11;
    return { keys: sortKeys(res.keys, input.sort), workspaces: res.workspaces, partial: res.partial };
  },
});

export const keysShow = defineOp({
  id: "keys.show",
  role: "management",
  kind: "read",
  summary: "Show one API key",
  input: z.object({ ref: z.string().min(1), workspace: z.string().optional() }),
  async run(ctx, input) {
    const key = await resolveKey(ctx, input.ref, input.workspace);
    const res = await ctx.sdk.management().apiKeys.get({ hash: key.hash });
    return {
      ...res.data,
      workspaceSlug: key.workspaceSlug,
      workspaceName: key.workspaceName,
    } satisfies KeyItem;
  },
});
