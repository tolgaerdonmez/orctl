import { useEffect, useState } from "react";
import type { OrctlError } from "../../core/errors.ts";
import { getOp } from "../../core/ops/registry.ts";
import { specFor } from "../../surface/spec.ts";
import { TUI_ACTIONS } from "../actions.ts";
import { ChoiceList, TextField } from "../components/fields.tsx";
import { MODAL_CONTENT, Modal } from "../components/Modal.tsx";
import { TABS, type TabId, useKeys, useTui } from "../state.tsx";
import { profileHex, theme } from "../theme.ts";

/** ctrl+o quick profile switcher (plan §7.2: profile.use from anywhere). */
export function ProfileSwitcher() {
  const tui = useTui();
  const [names, setNames] = useState<Array<{ value: string; label: string; hint?: string }>>([]);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    void tui.ctx?.store.loadConfig().then((c) => {
      const list = Object.entries(c.config.profiles).map(([name, p]) => ({
        value: name,
        label: `${name === tui.profile?.name ? "●" : " "} ${name}`,
        hint: [p.label, p.color].filter(Boolean).join(" · "),
      }));
      setNames(list);
      setSelected(
        Math.max(
          0,
          list.findIndex((n) => n.value === tui.profile?.name),
        ),
      );
    });
  }, [tui.ctx, tui.profile?.name]);
  return (
    <Modal title="Switch profile" onClose={tui.closeModal} height={Math.min(16, names.length + 4)} width={50}>
      {names.length === 0 ? (
        <text fg={theme.muted}>No profiles. Add one on the Profiles screen (7, a).</text>
      ) : null}
      <ChoiceList
        focused
        priority={MODAL_CONTENT}
        options={names}
        selected={selected}
        onMove={setSelected}
        onChoose={(name) => {
          tui.closeModal();
          tui
            .switchProfile(name)
            .then(() => tui.toast(`Active profile: ${name}`, "good"))
            .catch((e: OrctlError) => tui.toast(e.message, "bad"));
        }}
      />
    </Modal>
  );
}

/** ctrl+p command palette (plan §7.2): every operation with its CLI form; enter jumps to it. */
export function Palette() {
  const tui = useTui();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const items = TUI_ACTIONS.map((a) => {
    const spec = specFor(a.op);
    const cli = spec ? `orctl ${spec.path.join(" ")}` : "";
    return { ...a, cli, summary: getOp(a.op).summary };
  }).filter((a) => {
    const q = query.toLowerCase();
    return !q || a.label.toLowerCase().includes(q) || a.cli.includes(q) || a.op.includes(q);
  });
  const clamped = Math.min(selected, Math.max(0, items.length - 1));
  useKeys((id) => {
    if (id === "up") {
      setSelected(Math.max(0, clamped - 1));
      return true;
    }
    if (id === "down") {
      setSelected(Math.min(items.length - 1, clamped + 1));
      return true;
    }
    return false;
  }, MODAL_CONTENT + 1);
  const choose = () => {
    const item = items[clamped];
    if (!item) return;
    tui.closeModal();
    const tab = TABS.find((t) => t.id === item.screen);
    if (tab) tui.goTab(tab.id as TabId);
    else tui.push({ id: item.screen });
  };
  const visible = items.slice(Math.max(0, clamped - 10), Math.max(0, clamped - 10) + 12);
  return (
    <Modal title="Command palette" onClose={tui.closeModal} width={90} height={18}>
      <TextField
        focused
        priority={MODAL_CONTENT}
        placeholder="type to filter operations…"
        width={60}
        onChange={(v) => {
          setQuery(v);
          setSelected(0);
        }}
        onSubmit={choose}
        onEscape={tui.closeModal}
      />
      {visible.map((item) => {
        const isSel = items.indexOf(item) === clamped;
        return (
          <text key={`${item.op}-${item.label}`} bg={isSel ? theme.selectionBg : undefined}>
            <span
              fg={isSel ? theme.selectionFg : theme.fg}
            >{`${isSel ? "›" : " "} ${item.label.padEnd(32)}`}</span>
            <span fg={theme.muted}>{` ${item.key ? `[${item.key}] ` : ""}${item.cli}`}</span>
          </text>
        );
      })}
      {items.length === 0 ? <text fg={theme.muted}>No matching operation.</text> : null}
    </Modal>
  );
}

/** Screens of later phases render this until they exist. */
export function Placeholder(props: { title: string }) {
  const tui = useTui();
  return (
    <box flexDirection="column" padding={1} borderColor={profileHex(tui.profile?.color)}>
      <text fg={theme.muted}>{`${props.title} is not available yet.`}</text>
    </box>
  );
}
