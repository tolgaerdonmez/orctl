import type { OrctlError } from "../../core/errors.ts";
import { shortLabel } from "../../core/format/views-keys.ts";
import type { KeyItem } from "../../core/ops/keys.ts";
import { Confirm, ConfirmTyped } from "../components/dialogs.tsx";
import type { TuiState } from "../state.tsx";
import { invalidateKeys } from "./KeyForm.tsx";

/**
 * Key actions shared by the Keys list and the key detail screen (plan §7.2):
 * n new · e edit · space enable/disable (confirmed) · D delete (typed name) · r rotate.
 */
export function keyAction(tui: TuiState, id: string, key: KeyItem | undefined): boolean {
  const fail = (err: unknown) => tui.toast((err as OrctlError).message ?? String(err), "bad");
  const where = key ? `in profile ${tui.profile?.name ?? "env"} / workspace ${key.workspaceSlug}` : "";
  switch (id) {
    case "n":
      tui.push({ id: "key-form", params: { mode: "create" } });
      return true;
    case "r":
      if (key) tui.push({ id: "rotate", params: { hash: key.hash } });
      return true;
    case "e":
      if (key) tui.push({ id: "key-form", params: { mode: "edit", hash: key.hash } });
      return true;
    case "space": {
      if (!key) return true;
      const op = key.disabled ? "keys.enable" : "keys.disable";
      const verb = key.disabled ? "Enable" : "Disable";
      tui.openModal(
        <Confirm
          title={`${verb} key`}
          prompt={`${verb} key "${key.name}" (${shortLabel(key.label)}) ${where}?`}
          onConfirm={() =>
            tui
              .runOp(op, { ref: key.hash })
              .then(async () => {
                tui.toast(`${verb}d ${key.name}`, "good");
                await invalidateKeys(tui);
              })
              .catch(fail)
          }
        />,
      );
      return true;
    }
    case "D":
      if (!key) return true;
      tui.openModal(
        <ConfirmTyped
          title="Delete key"
          prompt={`Delete key "${key.name}" (${shortLabel(key.label)}) ${where}? This cannot be undone.`}
          typed={key.name}
          onConfirm={() =>
            tui
              .runOp("keys.delete", { ref: key.hash })
              .then(async () => {
                tui.toast(`Deleted ${key.name}`, "good");
                await invalidateKeys(tui);
                if (tui.screen.id === "key-detail") tui.pop();
              })
              .catch(fail)
          }
        />,
      );
      return true;
    default:
      return false;
  }
}
