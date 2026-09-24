import { randomBytes } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite, readTextIfExists } from "../fs-util.ts";

/**
 * Rotation journal (plan §8.1): one JSON file per rotation under <state>/rotations/, 0600, with
 * no secret values, only hashes, names and the delivery target reference. It records each
 * completed step so an interrupted or failed rotation can be finished by hand (doctor explains
 * how). A rotation that completes, or rolls back cleanly, removes its journal.
 */
export type RotationStep =
  | "started"
  | "create-unknown"
  | "created"
  | "delivered"
  | "verify-failed"
  | "verified"
  | "old-updated"
  | "old-deleted"
  | "rollback-failed";

export interface RotationJournal {
  version: 1;
  id: string;
  profile: string;
  startedAt: string;
  old: { hash: string; name: string; label: string; workspace: string };
  plan: {
    newName: string;
    oldRename: string;
    keepOldEnabled: boolean;
    deleteOld: boolean;
    expiresAt: string | null;
  };
  target: string | null;
  newHash: string | null;
  steps: Array<{ step: RotationStep; at: string; note?: string | undefined }>;
}

export class JournalStore {
  constructor(readonly dir: string) {}

  newId(now: Date): string {
    return `${now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")}-${randomBytes(2).toString("hex")}`;
  }

  path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async write(j: RotationJournal): Promise<void> {
    await atomicWrite(this.path(j.id), `${JSON.stringify(j, null, 2)}\n`);
  }

  async step(j: RotationJournal, step: RotationStep, at: Date, note?: string): Promise<void> {
    j.steps.push({ step, at: at.toISOString(), ...(note ? { note } : {}) });
    await this.write(j);
  }

  async close(j: RotationJournal): Promise<void> {
    await rm(this.path(j.id), { force: true });
  }

  async list(): Promise<RotationJournal[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }
    const out: RotationJournal[] = [];
    for (const n of names.sort()) {
      try {
        const text = await readTextIfExists(join(this.dir, n));
        if (text) out.push(JSON.parse(text) as RotationJournal);
      } catch {
        // unreadable journal: skipped (doctor still lists the file count)
      }
    }
    return out;
  }
}

export function lastStep(j: RotationJournal): RotationStep {
  return j.steps[j.steps.length - 1]?.step ?? "started";
}

/** What to do about an open journal, in plain steps (plan §8.1: doctor prints the next step). */
export function recoverySteps(j: RotationJournal, journalPath: string): string[] {
  const oldRef = j.old.hash.slice(0, 12);
  const newRef = j.newHash?.slice(0, 12);
  const out: string[] = [];
  const done = `Then remove the journal: rm ${journalPath}`;
  switch (lastStep(j)) {
    case "started":
      out.push(`Nothing was created for "${j.old.name}"; the rotation stopped before creating a key.`);
      break;
    case "create-unknown":
      out.push(
        `Creating the new key for "${j.old.name}" failed on the network; it may exist without a usable plaintext.`,
        `Check: orctl keys list --workspace ${j.old.workspace} (look for "${j.plan.newName}" created after ${j.startedAt}) and delete it with orctl keys rm <hash> --yes.`,
      );
      break;
    case "created":
    case "rollback-failed":
      out.push(
        `A new key (${newRef}) was created for "${j.old.name}" but never delivered, so its plaintext is lost.`,
        `Delete it: orctl keys rm ${newRef} --yes. The old key ${oldRef} is unchanged.`,
      );
      break;
    case "delivered":
    case "verify-failed":
    case "verified":
      out.push(
        `The new key ${newRef} was delivered to ${j.target ?? "the user"}; the old key ${oldRef} is still active.`,
        `Once the new key works: orctl keys disable ${oldRef}` +
          (j.plan.deleteOld ? `, then orctl keys rm ${oldRef} --yes` : ""),
      );
      break;
    case "old-updated":
      out.push(
        j.plan.deleteOld
          ? `The old key ${oldRef} was ${j.plan.keepOldEnabled ? "renamed" : "disabled"} but not deleted: orctl keys rm ${oldRef} --yes`
          : "All steps finished; only the journal is left.",
      );
      break;
    case "old-deleted":
      out.push("All steps finished; only the journal is left.");
      break;
  }
  out.push(done);
  return out;
}
