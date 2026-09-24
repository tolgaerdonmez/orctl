import { z } from "zod";
import { MUTATION } from "../client/factory.ts";
import { mapError } from "../client/map-error.ts";
import { OrctlError, usageError } from "../errors.ts";
import { formatUsd } from "../format/money.ts";
import { formatDay, isoSeconds, parseExpires, toDate } from "../format/time.ts";
import { guardInterrupts, interruptRequested } from "../interrupt.ts";
import { JournalStore, type RotationJournal, recoverySteps } from "../journal/rotation-journal.ts";
import { Secret } from "../secret.ts";
import { parseSecretRef } from "../secrets/ref.ts";
import type { KeyItem } from "./keys.ts";
import { resolveKey } from "./keys.ts";
import { type Delivered, type Delivery, deliverKey, findOrphans, orphanError } from "./keys-mutate.ts";
import { probeUser } from "./probes.ts";
import { type Ctx, defineOp } from "./types.ts";

/**
 * Key rotation (plan §8.1): create a replacement with the same name and limits → deliver it →
 * verify it with GET /key (no spend) → rename and disable the old key → optionally delete it.
 * The planner is pure; the executor keeps a secret-free journal and rolls back what it can.
 */

export interface RotationOptions {
  expires?: string | undefined;
  keepOldEnabled?: boolean | undefined;
  deleteOld?: boolean | undefined;
}

export interface RotationPlan {
  old: KeyItem;
  newName: string;
  oldRename: string;
  expiresAt: Date | null;
  expiresReason: "flag" | "same-lifetime" | "none";
  keepOldEnabled: boolean;
  deleteOld: boolean;
  createBody: {
    name: string;
    limit?: number;
    limitReset?: "daily" | "weekly" | "monthly";
    includeByokInLimit: boolean;
    workspaceId: string;
    expiresAt?: Date;
  };
  warnings: string[];
}

export function planRotation(old: KeyItem, opts: RotationOptions, now: Date): RotationPlan {
  let expiresAt: Date | null = null;
  let expiresReason: RotationPlan["expiresReason"] = "none";
  if (opts.expires) {
    expiresAt = parseExpires(opts.expires, now);
    expiresReason = "flag";
  } else {
    const oldExp = toDate(old.expiresAt as Date | string | null | undefined);
    const oldCreated = toDate(old.createdAt);
    if (oldExp && oldCreated && oldExp > oldCreated) {
      // Same lifetime length as the old key, starting now.
      expiresAt = new Date(
        Math.floor((now.getTime() + (oldExp.getTime() - oldCreated.getTime())) / 1000) * 1000,
      );
      expiresReason = "same-lifetime";
    }
  }
  const reset = old.limitReset;
  const warnings = [
    "The new key's usage and limit counters start from zero.",
    "Rate limits are account-wide; a new key does not raise them.",
  ];
  if (old.disabled) warnings.push("The old key is already disabled.");
  return {
    old,
    newName: old.name,
    oldRename: `${old.name} (rotated ${formatDay(now)})`,
    expiresAt,
    expiresReason,
    keepOldEnabled: Boolean(opts.keepOldEnabled),
    deleteOld: Boolean(opts.deleteOld),
    warnings,
    createBody: {
      name: old.name,
      ...(old.limit !== null ? { limit: old.limit } : {}),
      ...(reset === "daily" || reset === "weekly" || reset === "monthly" ? { limitReset: reset } : {}),
      includeByokInLimit: old.includeByokInLimit,
      workspaceId: old.workspaceId,
      ...(expiresAt ? { expiresAt: new Date(isoSeconds(expiresAt)) } : {}),
    },
  };
}

export function describePlan(plan: RotationPlan, profile: string): string {
  const k = plan.old;
  const limit =
    k.limit === null ? "no limit" : `limit ${formatUsd(k.limit)}${k.limitReset ? ` ${k.limitReset}` : ""}`;
  const exp = plan.expiresAt
    ? `expires ${formatDay(plan.expiresAt)}${plan.expiresReason === "same-lifetime" ? " (same lifetime as the old key)" : ""}`
    : "no expiry";
  const oldFate = plan.deleteOld
    ? "delete the old key"
    : plan.keepOldEnabled
      ? `rename the old key to "${plan.oldRename}" and keep it enabled`
      : `disable the old key and rename it to "${plan.oldRename}"`;
  return `Rotate key "${k.name}" (${k.label}) in profile ${profile} / workspace ${k.workspaceSlug}: create a replacement (${limit}, ${exp}), then ${oldFate}?`;
}

const RotateInput = z.object({
  ref: z.string().min(1),
  workspace: z.string().optional(),
  expires: z.string().optional(),
  store: z.union([z.string(), z.literal(true)]).optional(),
  show: z.boolean().optional(),
  copy: z.boolean().optional(),
  keepOldEnabled: z.boolean().optional(),
  deleteOld: z.boolean().optional(),
  verify: z.boolean().default(true),
});
export type RotateInput = z.infer<typeof RotateInput>;

export interface RotationResult {
  old: { hash: string; name: string; renamedTo: string; disabled: boolean; deleted: boolean };
  new: KeyItem;
  key?: string;
  storedAt: string | null;
  copied: boolean;
  shown: boolean;
  verified: boolean;
  warnings: string[];
}

export type RotationStepEvent = {
  step: string;
  status: "running" | "done" | "failed" | "skipped";
  detail?: string;
};

/**
 * Where the new key goes (plan §8.1). When the key being rotated is the profile's own user key,
 * the default target is the profile's user reference: a keychain: ref is updated in place, while
 * op:// or env: refs cannot be written, so --show or --copy is required.
 */
async function resolveDelivery(
  ctx: Ctx,
  old: KeyItem,
  input: RotateInput,
): Promise<Delivery & { target?: string }> {
  let profileUserKey = false;
  const userRef = ctx.profile?.userRef;
  if (userRef) {
    try {
      const me = await probeUser(ctx.sdk.user());
      profileUserKey = me.label === old.label;
    } catch {
      profileUserKey = false;
    }
  }
  const given = Boolean(input.store || input.show || input.copy);
  const writableUserRef = Boolean(userRef && profileUserKey && parseSecretRef(userRef).scheme === "keychain");
  if (profileUserKey && userRef && (input.store === true || !given)) {
    if (writableUserRef) return { ...input, store: true, target: userRef };
    const cannotWrite = usageError(
      `This is the profile's user key, stored at ${userRef}, which orctl cannot write.`,
      "Use --show or --copy and update that reference yourself.",
    );
    if (input.store === true) throw cannotWrite;
    const ask = ctx.askDelivery ? await ctx.askDelivery(["show", "copy"]) : undefined;
    if (ask) return { [ask]: true };
    throw cannotWrite;
  }
  if (given) return input;
  const ask = ctx.askDelivery ? await ctx.askDelivery(["store", "show", "copy"]) : undefined;
  if (ask) return { [ask]: true };
  throw usageError(
    "Choose how to receive the new key: --store [keychain:…], --show or --copy.",
    "The key's plaintext is returned only once and cannot be read again later.",
  );
}

function checkpoint(journal: RotationJournal, store: JournalStore): void {
  if (!interruptRequested()) return;
  throw new OrctlError("INTERRUPTED", "Rotation interrupted between steps.", {
    hint: recoverySteps(journal, store.path(journal.id)).join("\n"),
  });
}

export async function executeRotation(
  ctx: Ctx,
  input: RotateInput,
  onStep: (e: RotationStepEvent) => void = () => {},
): Promise<RotationResult> {
  const store = new JournalStore(ctx.paths.rotationsDir);
  const profile = ctx.profile?.name ?? "env";
  const old = await resolveKey(ctx, input.ref, input.workspace);
  const plan = planRotation(old, input, ctx.clock.now());
  const delivery = await resolveDelivery(ctx, old, input);
  const now = () => ctx.clock.now();
  const journal: RotationJournal = {
    version: 1,
    id: store.newId(now()),
    profile,
    startedAt: now().toISOString(),
    old: { hash: old.hash, name: old.name, label: old.label, workspace: old.workspaceSlug },
    plan: {
      newName: plan.newName,
      oldRename: plan.oldRename,
      keepOldEnabled: plan.keepOldEnabled,
      deleteOld: plan.deleteOld,
      expiresAt: plan.expiresAt?.toISOString() ?? null,
    },
    target:
      typeof delivery.store === "string"
        ? delivery.store
        : (delivery.target ?? (delivery.show ? "show" : delivery.copy ? "copy" : null)),
    newHash: null,
    steps: [{ step: "started", at: now().toISOString() }],
  };
  await store.write(journal);
  const keep = (e: OrctlError): OrctlError =>
    new OrctlError(e.code, e.message, {
      hint: [e.hint, ...recoverySteps(journal, store.path(journal.id))].filter(Boolean).join("\n"),
      httpStatus: e.httpStatus,
      details: e.details,
    });

  return guardInterrupts(async () => {
    const mgmt = ctx.sdk.management();
    // 1: re-read the old key so the plan is based on its current state
    onStep({ step: "check old key", status: "running" });
    try {
      await mgmt.apiKeys.get({ hash: old.hash });
    } catch (err) {
      await store.close(journal);
      throw mapError(err, { role: "management", profile });
    }
    onStep({ step: "check old key", status: "done" });
    checkpoint(journal, store);

    // 2: create the replacement (sent once)
    onStep({ step: "create new key", status: "running" });
    let created: Awaited<ReturnType<typeof mgmt.apiKeys.create>>;
    try {
      created = await mgmt.apiKeys.create({ requestBody: plan.createBody }, MUTATION);
    } catch (err) {
      const e = mapError(err, { mutation: true, role: "management", profile });
      onStep({ step: "create new key", status: "failed", detail: e.message });
      if (e.code === "UNKNOWN_OUTCOME") {
        await store.step(journal, "create-unknown", now());
        throw keep(
          orphanError(
            e,
            await findOrphans(ctx, plan.newName, new Date(journal.startedAt), old.workspaceSlug),
          ),
        );
      }
      await store.close(journal);
      throw e;
    }
    const secret = new Secret(created.key);
    const newHash = created.data.hash;
    journal.newHash = newHash;
    await store.step(journal, "created", now());
    onStep({ step: "create new key", status: "done", detail: newHash.slice(0, 12) });

    // 3: deliver; on failure delete the new key again
    onStep({ step: "deliver", status: "running" });
    let delivered: Delivered;
    try {
      delivered = await deliverKey(ctx, secret, delivery, {
        name: plan.newName,
        hash: newHash,
        target: delivery.target,
      });
    } catch (err) {
      const failure = mapError(err);
      onStep({ step: "deliver", status: "failed", detail: failure.message });
      try {
        await mgmt.apiKeys.delete({ hash: newHash }, MUTATION);
      } catch (deleteErr) {
        await store.step(journal, "rollback-failed", now(), mapError(deleteErr).message);
        const message = `Delivering the new key failed (${failure.message}) and deleting it again also failed (${mapError(deleteErr).message}).`;
        if (ctx.emergencyReveal) await ctx.emergencyReveal(secret, message);
        throw keep(new OrctlError("UNKNOWN_OUTCOME", message));
      }
      await store.close(journal);
      throw new OrctlError(
        failure.code,
        `Delivering the new key failed: ${failure.message} The new key was deleted; the old key is unchanged.`,
        {
          hint: failure.hint,
        },
      );
    }
    journal.target =
      delivered.storedAt ??
      (delivered.copied ? "the clipboard" : delivered.shown ? "stdout (shown once)" : journal.target);
    await store.step(journal, "delivered", now());
    onStep({
      step: "deliver",
      status: "done",
      detail: delivered.storedAt ?? (delivered.copied ? "clipboard" : "shown"),
    });
    checkpoint(journal, store);

    // 4: verify the new key with GET /key (no inference spend)
    let verified = false;
    if (input.verify) {
      onStep({ step: "verify new key", status: "running" });
      try {
        await probeUser(ctx.sdk.withKey("user", secret));
        verified = true;
        await store.step(journal, "verified", now());
        onStep({ step: "verify new key", status: "done" });
      } catch (err) {
        const e = mapError(err, { role: "user" });
        await store.step(journal, "verify-failed", now(), e.message);
        onStep({ step: "verify new key", status: "failed", detail: e.message });
        throw keep(
          new OrctlError(
            "AUTH",
            `The new key failed verification (${e.message}); the old key was left active.`,
            {
              httpStatus: e.httpStatus,
            },
          ),
        );
      }
    } else onStep({ step: "verify new key", status: "skipped" });
    checkpoint(journal, store);

    // 5: rename (and by default disable) the old key
    onStep({ step: "retire old key", status: "running" });
    try {
      await mgmt.apiKeys.update(
        {
          hash: old.hash,
          requestBody: plan.keepOldEnabled
            ? { name: plan.oldRename }
            : { name: plan.oldRename, disabled: true },
        },
        MUTATION,
      );
    } catch (err) {
      const e = mapError(err, { mutation: true, role: "management", profile });
      onStep({ step: "retire old key", status: "failed", detail: e.message });
      throw keep(
        new OrctlError(e.code, `The new key is in place, but updating the old key failed: ${e.message}`),
      );
    }
    await store.step(journal, "old-updated", now());
    onStep({ step: "retire old key", status: "done" });

    // 6: optionally delete the old key
    let deleted = false;
    if (plan.deleteOld) {
      checkpoint(journal, store);
      onStep({ step: "delete old key", status: "running" });
      try {
        await mgmt.apiKeys.delete({ hash: old.hash }, MUTATION);
      } catch (err) {
        const e = mapError(err, { mutation: true, role: "management", profile });
        onStep({ step: "delete old key", status: "failed", detail: e.message });
        throw keep(
          new OrctlError(e.code, `The new key is in place, but deleting the old key failed: ${e.message}`),
        );
      }
      deleted = true;
      await store.step(journal, "old-deleted", now());
      onStep({ step: "delete old key", status: "done" });
    }

    await store.close(journal);
    return {
      old: {
        hash: old.hash,
        name: old.name,
        renamedTo: plan.oldRename,
        disabled: !plan.keepOldEnabled,
        deleted,
      },
      new: { ...created.data, workspaceSlug: old.workspaceSlug, workspaceName: old.workspaceName },
      ...(delivery.show ? { key: created.key } : {}),
      ...delivered,
      verified,
      warnings: plan.warnings,
    };
  });
}

/** Open journals of earlier rotations, with the next step for each (plan §8.1). */
export async function openRotations(
  ctx: Ctx,
): Promise<Array<{ journal: RotationJournal; path: string; steps: string[] }>> {
  const store = new JournalStore(ctx.paths.rotationsDir);
  return (await store.list()).map((journal) => ({
    journal,
    path: store.path(journal.id),
    steps: recoverySteps(journal, store.path(journal.id)),
  }));
}

export const keysRotate = defineOp({
  id: "keys.rotate",
  role: "management",
  kind: "destructive",
  summary: "Replace a key: create, deliver, verify, then disable (or delete) the old one",
  input: RotateInput,
  async confirm(ctx, input) {
    const old = await resolveKey(ctx, input.ref, input.workspace);
    const plan = planRotation(old, input, ctx.clock.now());
    return {
      prompt: describePlan(plan, ctx.profile?.name ?? "env"),
      typed: plan.deleteOld ? old.name : undefined,
    };
  },
  async run(ctx, input) {
    for (const open of await openRotations(ctx)) {
      ctx.meta.warnings.push(
        `An earlier rotation of "${open.journal.old.name}" is unfinished: ${open.steps[0]}`,
      );
    }
    const result = await executeRotation(ctx, input);
    ctx.meta.warnings.push(...result.warnings);
    return result;
  },
});
