import { useState } from "react";
import type { OrctlError } from "../../core/errors.ts";
import { plainStyle } from "../../core/format/view.ts";
import { profileViews } from "../../core/format/views-profile.ts";
import type { DoctorCheck } from "../../core/ops/auth.ts";
import { Panel } from "../components/Shell.tsx";
import { bindingsFor, GLOBAL_BINDINGS } from "../keymap.ts";
import { TABS, useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";

/** Help (plan §7.3): generated from the key table, plus diagnostics (auth.doctor). */
export function HelpScreen() {
  const tui = useTui();
  const [doctor, setDoctor] = useState<string[] | null>(null);
  useCliHint("auth.doctor", {});
  useKeys((id) => {
    if (id === "d") {
      setDoctor(["Running diagnostics…"]);
      tui
        .runOp<{ checks: DoctorCheck[]; summary: { ok: number; warn: number; fail: number } }>(
          "auth.doctor",
          {},
        )
        .then((r) => {
          const view = profileViews["auth.doctor"];
          setDoctor(view?.kind === "lines" ? view.lines(r, plainStyle, new Date()) : []);
        })
        .catch((e: OrctlError) => setDoctor([`✖ ${e.message}`]));
      return true;
    }
    return false;
  });
  const screens = [...TABS.map((t) => t.id)];
  const pad = (s: string) => s.padEnd(10);
  return (
    <box flexDirection="row" flexGrow={1}>
      <Panel title="Keys" width="50%">
        <text fg={theme.accent}>Global</text>
        {GLOBAL_BINDINGS.map((b) => (
          <text key={b.key} fg={theme.fg}>{`  ${pad(b.key)} ${b.label}`}</text>
        ))}
        {screens.map((s) => {
          const bindings = bindingsFor(s);
          if (bindings.length === 0) return null;
          return (
            <box key={s} flexDirection="column">
              <text fg={theme.accent}>{s}</text>
              {bindings.map((b) => (
                <text key={b.key} fg={theme.fg}>{`  ${pad(b.key)} ${b.label}`}</text>
              ))}
            </box>
          );
        })}
      </Panel>
      <Panel title="Diagnostics">
        {doctor ? (
          doctor.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static line list.
            <text key={i} fg={l.startsWith("✖") ? theme.bad : l.startsWith("!") ? theme.warn : theme.fg}>
              {l}
            </text>
          ))
        ) : (
          <text fg={theme.muted}>Press d to run `orctl doctor` (read-only checks).</text>
        )}
      </Panel>
    </box>
  );
}
