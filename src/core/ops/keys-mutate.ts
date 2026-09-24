import { z } from "zod";
import { MUTATION } from "../client/factory.ts";
import { mapError } from "../client/map-error.ts";
import { type OrctlError, OrctlError as OrctlErrorClass, usageError } from "../errors.ts";
import { isoSeconds, parseExpires } from "../format/time.ts";
import { Secret } from "../secret.ts";
import { generatedKeyRef, parseSecretRef } from "../secrets/ref.ts";
import { describeKey, type KeyItem, listAllKeys, resolveKey } from "./keys.ts";
import { type Ctx, defineOp } from "./types.ts";
import { resolveWorkspace } from "./workspace-ref.ts";

/**
 * Key mutations (plan §7.2, §8.1, §9). Every mutating call passes MUTATION (no retries) so a
 * flaky network cannot create duplicate keys. The plaintext of a new key exists only in memory and
 * goes to exactly one of: the Keychain (--store), stdout (--show) or the clipboard (--copy).
 */

export const RESETS = ["daily", "weekly", "monthly", "none"] as const;
type Reset = (typeof RESETS)[number];
const resetValue = (r: Reset | undefined) => (r === undefined ? undefined : r === "none" ? null : r);

export interface Delivery {
  store?: string | true | undefined;
  show?: boolean | undefined;
  copy?: boolean | undefined;
}

export function requireDelivery(d: Delivery, what: string): void {
  if (!d.store && !d.show && !d.copy) {
    throw usageError(
      `Choose how to receive the ${what}: --store [keychain:…], --show or --copy.`,
      "The key's plaintext is returned only once and cannot be read again later.",
    );
  }
  if (typeof d.store === "string") {
    const ref = parseSecretRef(d.store);
    if (ref.scheme !== "keychain") throw usageError("--store only writes keychain: references.");
  }
}

export interface Delivered {
  storedAt: string | null;
  copied: boolean;
  shown: boolean;
}

/** Stores/copies a new key. Throws if any requested delivery fails. */
export async function deliverKey(
  ctx: Ctx,
  secret: Secret,
  d: Delivery,
  info: { name: string; hash: string; target?: string | undefined },
): Promise<Delivered> {
  const profile = ctx.profile?.name ?? "env";
  let storedAt: string | null = null;
  if (d.store) {
    const target =
      typeof d.store === "string" ? d.store : (info.target ?? generatedKeyRef(profile, info.name, info.hash));
    await ctx.secrets.write(
      target,
      secret,
      `orctl ${profile} key ${info.name}`.replace(/[^A-Za-z0-9 ._/-]/g, "-"),
    );
    storedAt = target;
  }
  if (d.copy) {
    await ctx.clipboard.copy(secret.reveal());
    ctx.clipboard.clearLater(secret.reveal());
    ctx.meta.warnings.push(
      "Copied to the clipboard; it is cleared in 45 s if unchanged. Clipboard history tools may keep a copy.",
    );
  }
  return { storedAt, copied: Boolean(d.copy), shown: Boolean(d.show) };
}

/**
 * After a create failed on the network (outcome unknown), look for a key that may have been
 * created anyway: same name, created at or after the attempt. It has no retrievable plaintext.
 */
export async function findOrphans(
  ctx: Ctx,
  name: string,
  since: Date,
  workspace?: string,
): Promise<KeyItem[]> {
  try {
    const { keys } = await listAllKeys(ctx, { workspace, includeDisabled: true });
    const cutoff = since.getTime() - 60_000;
    return keys.filter((k) => k.name === name && new Date(k.createdAt).getTime() >= cutoff);
  } catch {
    return [];
  }
}

export function orphanError(err: OrctlError, orphans: KeyItem[]): OrctlError {
  if (orphans.length === 0) {
    return new OrctlErrorClass("UNKNOWN_OUTCOME", `${err.message} No new key with this name was found.`, {
      hint: "Run `orctl keys list` to check before trying again.",
    });
  }
  return new OrctlErrorClass(
    "UNKNOWN_OUTCOME",
    `${err.message} A key was created anyway, but its plaintext was never received: ${orphans.map(describeKey).join(", ")}.`,
    {
      hint: `It cannot be used; delete it: ${orphans.map((k) => `orctl keys rm ${k.hash.slice(0, 12)} --yes`).join(" ; ")}`,
      details: { orphans: orphans.map((k) => ({ hash: k.hash, name: k.name, workspace: k.workspaceSlug })) },
    },
  );
}

/** Deletes a just-created key after its delivery failed; reports what happened. */
async function rollback(ctx: Ctx, secret: Secret, hash: string, failure: OrctlError): Promise<never> {
  try {
    await ctx.sdk.management().apiKeys.delete({ hash }, MUTATION);
  } catch (deleteErr) {
    const message = `Delivering the new key failed (${failure.message}) and deleting it again also failed (${mapError(deleteErr).message}).`;
    if (ctx.emergencyReveal) await ctx.emergencyReveal(secret, message);
    throw new OrctlErrorClass("UNKNOWN_OUTCOME", message, {
      hint: `Store the key now if it was shown, or delete it: orctl keys rm ${hash.slice(0, 12)} --yes`,
      details: { hash },
    });
  }
  throw new OrctlErrorClass(
    failure.code,
    `Delivering the new key failed: ${failure.message} The key was deleted again.`,
    {
      hint: failure.hint,
    },
  );
}

export const keysCreate = defineOp({
  id: "keys.create",
  role: "management",
  kind: "mutate",
  summary: "Create an API key and deliver it once (Keychain, stdout or clipboard)",
  input: z.object({
    name: z.string().min(1).max(100),
    limit: z.number().nonnegative().optional(),
    reset: z.enum(RESETS).optional(),
    expires: z.string().optional(),
    workspace: z.string().optional(),
    includeByokInLimit: z.boolean().optional(),
    store: z.union([z.string(), z.literal(true)]).optional(),
    show: z.boolean().optional(),
    copy: z.boolean().optional(),
  }),
  async run(ctx, input) {
    requireDelivery(input, "new key");
    const now = ctx.clock.now();
    const expiresAt = input.expires ? parseExpires(input.expires, now) : undefined;
    const wsRef = input.workspace ?? ctx.profile?.workspace;
    const workspace = wsRef ? await resolveWorkspace(ctx, wsRef) : undefined;
    let created: Awaited<ReturnType<ReturnType<Ctx["sdk"]["management"]>["apiKeys"]["create"]>>;
    try {
      created = await ctx.sdk.management().apiKeys.create(
        {
          requestBody: {
            name: input.name,
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
            ...(resetValue(input.reset) !== undefined ? { limitReset: resetValue(input.reset) } : {}),
            ...(expiresAt ? { expiresAt: new Date(isoSeconds(expiresAt)) } : {}),
            ...(workspace ? { workspaceId: workspace.id } : {}),
            ...(input.includeByokInLimit !== undefined
              ? { includeByokInLimit: input.includeByokInLimit }
              : {}),
          },
        },
        MUTATION,
      );
    } catch (err) {
      const e = mapError(err, { mutation: true, role: "management", profile: ctx.profile?.name });
      if (e.code === "UNKNOWN_OUTCOME")
        throw orphanError(e, await findOrphans(ctx, input.name, now, workspace?.slug));
      throw e;
    }
    const secret = new Secret(created.key);
    const hash = created.data.hash;
    let delivered: Delivered;
    try {
      delivered = await deliverKey(ctx, secret, input, { name: input.name, hash });
    } catch (err) {
      return rollback(ctx, secret, hash, mapError(err));
    }
    return {
      apiKey: {
        ...created.data,
        workspaceSlug: workspace?.slug ?? "default",
        workspaceName: workspace?.name ?? "Default",
      },
      ...(input.show ? { key: created.key } : {}),
      ...delivered,
    };
  },
});

const LimitInput = z.union([z.number().nonnegative(), z.null()]);

export const keysUpdate = defineOp({
  id: "keys.update",
  role: "management",
  kind: "mutate",
  summary: "Rename a key or change its limit",
  input: z.object({
    ref: z.string().min(1),
    workspace: z.string().optional(),
    rename: z.string().min(1).max(100).optional(),
    limit: LimitInput.optional(),
    reset: z.enum(RESETS).optional(),
    includeByokInLimit: z.boolean().optional(),
  }),
  async run(ctx, input) {
    if (
      input.rename === undefined &&
      input.limit === undefined &&
      input.reset === undefined &&
      input.includeByokInLimit === undefined
    ) {
      throw usageError("Nothing to change: pass --rename, --limit, --reset or --include-byok-in-limit.");
    }
    const key = await resolveKey(ctx, input.ref, input.workspace);
    const res = await ctx.sdk.management().apiKeys.update(
      {
        hash: key.hash,
        requestBody: {
          ...(input.rename !== undefined ? { name: input.rename } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(resetValue(input.reset) !== undefined ? { limitReset: resetValue(input.reset) } : {}),
          ...(input.includeByokInLimit !== undefined ? { includeByokInLimit: input.includeByokInLimit } : {}),
        },
      },
      MUTATION,
    );
    return {
      ...res.data,
      workspaceSlug: key.workspaceSlug,
      workspaceName: key.workspaceName,
    } satisfies KeyItem;
  },
});

async function setDisabled(ctx: Ctx, ref: string, workspace: string | undefined, disabled: boolean) {
  const key = await resolveKey(ctx, ref, workspace);
  const res = await ctx.sdk
    .management()
    .apiKeys.update({ hash: key.hash, requestBody: { disabled } }, MUTATION);
  return {
    ...res.data,
    workspaceSlug: key.workspaceSlug,
    workspaceName: key.workspaceName,
  } satisfies KeyItem;
}

const RefInput = z.object({ ref: z.string().min(1), workspace: z.string().optional() });

export const keysDisable = defineOp({
  id: "keys.disable",
  role: "management",
  kind: "mutate",
  summary: "Disable a key (reversible)",
  input: RefInput,
  run: (ctx, input) => setDisabled(ctx, input.ref, input.workspace, true),
});

export const keysEnable = defineOp({
  id: "keys.enable",
  role: "management",
  kind: "mutate",
  summary: "Enable a disabled key",
  input: RefInput,
  run: (ctx, input) => setDisabled(ctx, input.ref, input.workspace, false),
});

export function destructiveTarget(ctx: Ctx, key: KeyItem): string {
  return `in profile ${ctx.profile?.name ?? "env"} / workspace ${key.workspaceSlug}`;
}

export const keysDelete = defineOp({
  id: "keys.delete",
  role: "management",
  kind: "destructive",
  summary: "Delete a key permanently",
  input: RefInput,
  async confirm(ctx, input) {
    const key = await resolveKey(ctx, input.ref, input.workspace);
    return {
      prompt: `Delete key "${key.name}" (${key.label}) ${destructiveTarget(ctx, key)}? This cannot be undone.`,
      typed: key.name,
    };
  },
  async run(ctx, input) {
    const key = await resolveKey(ctx, input.ref, input.workspace);
    await ctx.sdk.management().apiKeys.delete({ hash: key.hash }, MUTATION);
    return { deleted: true, hash: key.hash, name: key.name, label: key.label, workspace: key.workspaceSlug };
  },
});
