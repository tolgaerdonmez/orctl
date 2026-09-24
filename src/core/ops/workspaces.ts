import type { Workspace, WorkspaceBudget, WorkspaceMember } from "@openrouter/sdk/models";
import { z } from "zod";
import { MUTATION } from "../client/factory.ts";
import { usageError } from "../errors.ts";
import { listAllKeys } from "./keys.ts";
import { type Ctx, defineOp } from "./types.ts";
import { listWorkspaces, resolveWorkspace } from "./workspace-ref.ts";

/**
 * Workspaces, budgets and members (plan §7.2). Membership is read-only in v1 by design: org
 * membership is sensitive and outside the "simple surface" the plan locked.
 */
export type { Workspace, WorkspaceBudget, WorkspaceMember };

export const BUDGET_INTERVALS = ["daily", "weekly", "monthly", "lifetime"] as const;
export type BudgetInterval = (typeof BUDGET_INTERVALS)[number];
const MAX_MEMBER_PAGES = 50;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

async function members(ctx: Ctx, id: string): Promise<WorkspaceMember[]> {
  const first = await ctx.sdk.management().workspaces.listMembers({ id, limit: 100 });
  const out: WorkspaceMember[] = [];
  let pages = 0;
  for await (const page of first) {
    out.push(...page.result.data);
    if (++pages >= MAX_MEMBER_PAGES) break;
  }
  return out;
}

export const workspacesList = defineOp({
  id: "workspaces.list",
  role: "management",
  kind: "read",
  summary: "List workspaces",
  input: z.object({}),
  async run(ctx) {
    const { workspaces, available } = await listWorkspaces(ctx);
    if (!available) ctx.meta.warnings.push("This key cannot list workspaces.");
    return { workspaces };
  },
});

export interface WorkspaceDetail {
  workspace: Workspace;
  budgets: WorkspaceBudget[];
  includeByokInBudgets: boolean;
  members: WorkspaceMember[];
  keys: number;
}

export async function workspaceDetail(ctx: Ctx, ref: string): Promise<WorkspaceDetail> {
  const w = await resolveWorkspace(ctx, ref);
  const mgmt = ctx.sdk.management();
  const [full, budgets, memberList, keys] = await Promise.all([
    mgmt.workspaces.get({ id: w.id }),
    mgmt.workspaces.listBudgets({ workspaceRef: w.id }),
    members(ctx, w.id).catch(() => {
      ctx.meta.warnings.push("Members could not be listed.");
      return [];
    }),
    listAllKeys(ctx, { workspace: w.id, includeDisabled: true })
      .then((r) => r.keys.length)
      .catch(() => -1),
  ]);
  return {
    workspace: full.data,
    budgets: budgets.data,
    includeByokInBudgets: Boolean(budgets.includeByokInBudgets),
    members: memberList,
    keys,
  };
}

export const workspacesShow = defineOp({
  id: "workspaces.show",
  role: "management",
  kind: "read",
  summary: "Show a workspace with its budgets, members and key count",
  input: z.object({ ref: z.string().min(1) }),
  run: (ctx, input) => workspaceDetail(ctx, input.ref),
});

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "slugs use a-z, 0-9 and -");

export const workspacesCreate = defineOp({
  id: "workspaces.create",
  role: "management",
  kind: "mutate",
  summary: "Create a workspace",
  input: z.object({
    name: z.string().min(1).max(100),
    slug: Slug.optional(),
    description: z.string().max(500).optional(),
  }),
  async run(ctx, input) {
    const res = await ctx.sdk.management().workspaces.create(
      {
        createWorkspaceRequest: {
          name: input.name,
          slug: input.slug ?? slugify(input.name),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      },
      MUTATION,
    );
    return res.data;
  },
});

export const workspacesUpdate = defineOp({
  id: "workspaces.update",
  role: "management",
  kind: "mutate",
  summary: "Rename a workspace or change its slug or description",
  input: z.object({
    ref: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    slug: Slug.optional(),
    description: z.string().max(500).optional(),
  }),
  async run(ctx, input) {
    if (input.name === undefined && input.slug === undefined && input.description === undefined) {
      throw usageError("Nothing to change: pass --name, --slug or --description.");
    }
    const w = await resolveWorkspace(ctx, input.ref);
    const res = await ctx.sdk.management().workspaces.update(
      {
        id: w.id,
        updateWorkspaceRequest: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      },
      MUTATION,
    );
    return res.data;
  },
});

export const workspacesDelete = defineOp({
  id: "workspaces.delete",
  role: "management",
  kind: "destructive",
  summary: "Delete a workspace",
  input: z.object({ ref: z.string().min(1) }),
  async confirm(ctx, input) {
    const w = await resolveWorkspace(ctx, input.ref);
    return {
      prompt: `Delete workspace "${w.name}" (${w.slug}) in profile ${ctx.profile?.name ?? "env"}? Its keys and budgets go with it.`,
      typed: w.slug,
    };
  },
  async run(ctx, input) {
    const w = await resolveWorkspace(ctx, input.ref);
    if (w.slug === "default") {
      throw usageError(
        "orctl does not delete the default workspace.",
        "Use the OpenRouter website if you really mean to.",
      );
    }
    await ctx.sdk.management().workspaces.delete({ id: w.id }, MUTATION);
    return { deleted: true, id: w.id, slug: w.slug, name: w.name };
  },
});

export const workspacesMembers = defineOp({
  id: "workspaces.members",
  role: "management",
  kind: "read",
  summary: "List a workspace's members (read-only in v1)",
  input: z.object({ ref: z.string().min(1) }),
  async run(ctx, input) {
    const w = await resolveWorkspace(ctx, input.ref);
    return { workspace: { id: w.id, slug: w.slug, name: w.name }, members: await members(ctx, w.id) };
  },
});

export const budgetsList = defineOp({
  id: "budgets.list",
  role: "management",
  kind: "read",
  summary: "List a workspace's budgets",
  input: z.object({ ref: z.string().min(1) }),
  async run(ctx, input) {
    const w = await resolveWorkspace(ctx, input.ref);
    const res = await ctx.sdk.management().workspaces.listBudgets({ workspaceRef: w.id });
    return {
      workspace: { id: w.id, slug: w.slug, name: w.name },
      budgets: res.data,
      includeByokInBudgets: Boolean(res.includeByokInBudgets),
    };
  },
});

export const budgetsSet = defineOp({
  id: "budgets.set",
  role: "management",
  kind: "mutate",
  summary: "Set a workspace budget (daily, weekly, monthly or lifetime)",
  input: z.object({
    ref: z.string().min(1),
    interval: z.enum(BUDGET_INTERVALS),
    usd: z.number().nonnegative(),
    includeByok: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const w = await resolveWorkspace(ctx, input.ref);
    const res = await ctx.sdk.management().workspaces.setBudget(
      {
        workspaceRef: w.id,
        interval: input.interval,
        upsertWorkspaceBudgetRequest: {
          limitUsd: input.usd,
          ...(input.includeByok !== undefined ? { includeByokInBudgets: input.includeByok } : {}),
        },
      },
      MUTATION,
    );
    return {
      workspace: { id: w.id, slug: w.slug, name: w.name },
      budget: res.data,
      includeByokInBudgets: res.includeByokInBudgets,
    };
  },
});

export const budgetsDelete = defineOp({
  id: "budgets.delete",
  role: "management",
  kind: "destructive",
  summary: "Remove a workspace budget",
  input: z.object({ ref: z.string().min(1), interval: z.enum(BUDGET_INTERVALS) }),
  async confirm(ctx, input) {
    const w = await resolveWorkspace(ctx, input.ref);
    return {
      prompt: `Remove the ${input.interval} budget of workspace "${w.slug}" in profile ${ctx.profile?.name ?? "env"}?`,
    };
  },
  async run(ctx, input) {
    const w = await resolveWorkspace(ctx, input.ref);
    await ctx.sdk
      .management()
      .workspaces.deleteBudget({ workspaceRef: w.id, interval: input.interval }, MUTATION);
    return { deleted: true, workspace: w.slug, interval: input.interval };
  },
});
