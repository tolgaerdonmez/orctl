import { useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { TABS, useTui } from "../state.tsx";
import { profileHex, theme } from "../theme.ts";

/** `● personal · Kişisel · ws default · [M][U]` in the profile color (plan §6.10, §7.3). */
export function Header() {
  const { profile, ctxError } = useTui();
  const color = profileHex(profile?.color);
  const roles = profile ? `${profile.managementRef ? "[M]" : ""}${profile.userRef ? "[U]" : ""}` : "";
  return (
    <box flexDirection="row" height={1} backgroundColor={theme.headerBg} paddingX={1}>
      <text flexGrow={1}>
        {profile ? (
          <>
            <span fg={color}>{`● ${profile.name}`}</span>
            <span fg={theme.muted}>
              {`${profile.label ? ` · ${profile.label}` : ""} · ws ${profile.workspace ?? "default"} · ${roles || "no keys"} · via ${profile.source}`}
            </span>
          </>
        ) : (
          <span fg={ctxError ? theme.bad : theme.muted}>
            {ctxError ? `✖ ${ctxError.message}` : "○ no profile · public data only"}
          </span>
        )}
      </text>
      <text fg={theme.accent}>orctl</text>
    </box>
  );
}

export function Tabs() {
  const { stack } = useTui();
  const root = stack[0]?.id;
  return (
    <box flexDirection="row" height={1} paddingX={1}>
      <text>
        {TABS.map((t, i) => (
          <span
            key={t.id}
            fg={t.id === root ? theme.selectionFg : theme.muted}
            bg={t.id === root ? theme.selectionBg : undefined}
          >
            {` ${i + 1} ${t.title} `}
          </span>
        ))}
      </text>
    </box>
  );
}

export function Footer() {
  const { cliHint, busy } = useTui();
  const dims = useTerminalDimensions();
  const right = `${busy ? "working… · " : ""}y copy · ? help · ctrl+p palette`;
  const hint = cliHint ? `CLI: ${cliHint}` : "";
  const room = Math.max(0, dims.width - right.length - 4);
  const shown = hint.length > room ? `${hint.slice(0, Math.max(0, room - 1))}…` : hint;
  return (
    <box flexDirection="row" height={1} backgroundColor={theme.headerBg} paddingX={1}>
      <text flexGrow={1} fg={theme.muted}>
        {shown}
      </text>
      <text fg={theme.dim}>{right}</text>
    </box>
  );
}

export function Toasts() {
  const { toasts } = useTui();
  const dims = useTerminalDimensions();
  if (toasts.length === 0) return null;
  const color = { info: theme.accent, good: theme.good, warn: theme.warn, bad: theme.bad } as const;
  const width = Math.min(70, dims.width - 4);
  return (
    <box position="absolute" right={1} bottom={2} width={width} zIndex={200} flexDirection="column">
      {toasts.map((t) => (
        <box
          key={t.id}
          border
          borderStyle="rounded"
          borderColor={color[t.tone]}
          backgroundColor={theme.modalBg}
          paddingX={1}
        >
          <text fg={color[t.tone]}>{t.message}</text>
        </box>
      ))}
    </box>
  );
}

/** Frame for a screen body: title line plus content. */
export function Panel(props: {
  title?: string;
  children: ReactNode;
  flexGrow?: number;
  width?: number | `${number}%`;
}) {
  const { profile } = useTui();
  return (
    <box
      flexDirection="column"
      flexGrow={props.flexGrow ?? 1}
      width={props.width}
      border
      borderStyle="rounded"
      borderColor={profile ? profileHex(profile.color) : theme.border}
      title={props.title ? ` ${props.title} ` : undefined}
      paddingX={1}
    >
      {props.children}
    </box>
  );
}
