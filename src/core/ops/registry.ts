import { authDoctor, authWhoami } from "./auth.ts";
import { creditsGet } from "./credits.ts";
import { keysList, keysShow } from "./keys.ts";
import { keysCreate, keysDelete, keysDisable, keysEnable, keysUpdate } from "./keys-mutate.ts";
import { modelsEndpoints, modelsList, modelsShow } from "./models.ts";
import {
  profileAdd,
  profileList,
  profileRemove,
  profileRename,
  profileSet,
  profileShow,
  profileUse,
} from "./profile.ts";
import { providersList, providersShow } from "./providers.ts";
import type { AnyOperation, OpId } from "./types.ts";

/** Every operation orctl exposes; the CLI spec and the TUI actions are both checked against it. */
export const OPERATIONS: readonly AnyOperation[] = [
  profileList,
  profileShow,
  profileAdd,
  profileSet,
  profileUse,
  profileRename,
  profileRemove,
  authWhoami,
  authDoctor,
  modelsList,
  modelsShow,
  modelsEndpoints,
  providersList,
  providersShow,
  keysList,
  keysShow,
  creditsGet,
  keysCreate,
  keysUpdate,
  keysDisable,
  keysEnable,
  keysDelete,
];

const byId = new Map<string, AnyOperation>(OPERATIONS.map((op) => [op.id, op]));

export function getOp(id: OpId | string): AnyOperation {
  const op = byId.get(id);
  if (!op) throw new Error(`unknown operation ${id}`);
  return op;
}

export function hasOp(id: string): boolean {
  return byId.has(id);
}
