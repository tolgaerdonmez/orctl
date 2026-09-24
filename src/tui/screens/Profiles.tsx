import { useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import type { OrctlError } from "../../core/errors.ts";
import { plainStyle } from "../../core/format/view.ts";
import { profileColumns, profileViews } from "../../core/format/views-profile.ts";
import type { ProfileVerification, ProfileView } from "../../core/ops/profile.ts";
import { DataTable, listKeys } from "../components/DataTable.tsx";
import { ConfirmTyped, PromptModal } from "../components/dialogs.tsx";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { profileHex, theme } from "../theme.ts";

type Row = ProfileView & { verification?: ProfileVerification };

export function ProfilesScreen() {
  const tui = useTui();
  const dims = useTerminalDimensions();
  const list = useOp<{ profiles: Row[] }>("profile.list", {});
  const [verified, setVerified] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState(0);
  const rows = verified ?? list.data?.profiles ?? [];
  const current = rows[Math.min(selected, Math.max(0, rows.length - 1))];
  useCliHint("profile.list", verified ? { verify: true } : {});

  const fail = (err: unknown) => tui.toast((err as OrctlError).message ?? String(err), "bad");
  const refresh = async () => {
    setVerified(null);
    await tui.reload();
  };

  useKeys((id) => {
    if (listKeys(id, rows.length, selected, setSelected)) return true;
    switch (id) {
      case "a":
        tui.push({ id: "profile-wizard", params: { mode: "add" } });
        return true;
      case "e":
        if (current && !current.ephemeral)
          tui.push({ id: "profile-wizard", params: { mode: "edit", name: current.name } });
        return true;
      case "enter":
        if (current && !current.ephemeral) {
          tui
            .switchProfile(current.name)
            .then(() => tui.toast(`Active profile: ${current.name}`, "good"))
            .catch(fail);
        }
        return true;
      case "v":
        tui.toast("Verifying profiles…");
        tui
          .runOp<{ profiles: Row[] }>("profile.list", { verify: true })
          .then((r) => setVerified(r.profiles))
          .catch(fail);
        return true;
      case "R":
        if (!current || current.ephemeral) return true;
        tui.openModal(
          <PromptModal
            title="Rename profile"
            label={`New name for "${current.name}":`}
            initial={current.name}
            onSubmit={(newName) => {
              if (!newName || newName === current.name) return;
              tui
                .runOp("profile.rename", { name: current.name, newName })
                .then(async () => {
                  tui.toast(`Renamed to ${newName}`, "good");
                  await refresh();
                })
                .catch(fail);
            }}
          />,
        );
        return true;
      case "D":
        if (!current || current.ephemeral) return true;
        tui.openModal(
          <ConfirmTyped
            title="Remove profile"
            prompt={`Remove profile "${current.name}"${current.label ? ` (${current.label})` : ""}?`}
            extra="Keychain items are kept; use `orctl profile rm --purge-secrets` to delete them too."
            typed={current.name}
            onConfirm={() =>
              tui
                .runOp("profile.remove", { name: current.name })
                .then(async () => {
                  tui.toast(`Removed ${current.name}`, "good");
                  setSelected(0);
                  await refresh();
                })
                .catch(fail)
            }
          />,
        );
        return true;
      default:
        return false;
    }
  });

  const tableWidth = Math.max(30, Math.floor(dims.width * 0.58) - 4);
  const height = Math.max(4, dims.height - 7);
  const detail = current ? profileViews["profile.show"] : undefined;
  return (
    <box flexDirection="row" flexGrow={1}>
      <Panel title="Profiles" width="60%">
        {list.isLoading ? <text fg={theme.muted}>Loading…</text> : null}
        {list.error ? <text fg={theme.bad}>{list.error.message}</text> : null}
        <DataTable
          columns={profileColumns.filter((c) => verified || c.id !== "verified")}
          rows={rows}
          selected={selected}
          width={tableWidth}
          height={height - 2}
          empty="No profiles yet. Press a to add one."
          rowKey={(r) => r.name}
        />
        <text fg={theme.dim}>enter use · a add · e edit · R rename · D remove · v verify</text>
      </Panel>
      <Panel title={current ? current.name : "Profile"}>
        {current && detail?.kind === "lines" ? (
          <>
            <text fg={profileHex(current.color)}>{`● ${current.name}`}</text>
            {detail
              .lines(current, plainStyle, tui.ctx?.clock.now() ?? new Date())
              .slice(1)
              .map((l: string, i: number) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static line list.
                <text key={i} fg={theme.fg}>
                  {l}
                </text>
              ))}
            {current.verification ? <VerificationLines v={current.verification} /> : null}
          </>
        ) : (
          <text fg={theme.muted}>Select a profile.</text>
        )}
      </Panel>
    </box>
  );
}

function VerificationLines({ v }: { v: ProfileVerification }) {
  return (
    <box flexDirection="column" marginTop={1}>
      {v.management ? (
        <text fg={v.management.ok ? theme.good : theme.bad}>
          {v.management.ok
            ? `✔ management verified · credits $${v.management.credits.total.toFixed(2)} · used $${v.management.credits.used.toFixed(2)}`
            : `✖ management: ${v.management.error.message}`}
        </text>
      ) : null}
      {v.user ? (
        <text fg={v.user.ok ? theme.good : theme.bad}>
          {v.user.ok ? `✔ user key ${v.user.label}` : `✖ user: ${v.user.error.message}`}
        </text>
      ) : null}
    </box>
  );
}
