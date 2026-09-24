import { useState } from "react";
import { Secret } from "../../core/secret.ts";
import { generatedKeyRef } from "../../core/secrets/ref.ts";
import { useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";
import { MODAL_CONTENT, Modal } from "./Modal.tsx";

/**
 * Shows a new key exactly once (plan §7.3, §9 S5). `c` copies it (cleared after 45 s if
 * unchanged), `s` stores it in the Keychain, enter closes. Closing without copying or storing
 * asks once more. The value is dropped from state when the dialog closes, and the TUI runs on
 * the alternate screen, so it never lands in the terminal scrollback.
 */
export function SecretReveal(props: {
  plaintext: string;
  name: string;
  hash: string;
  title?: string;
  note?: string;
  /** Called after the dialog closed, with where the key went. */
  onDone?(result: { stored: string | null; copied: boolean }): void;
}) {
  const tui = useTui();
  const [value, setValue] = useState<string | null>(props.plaintext);
  const [stored, setStored] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (!stored && !copied && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    setValue(null);
    tui.closeModal();
    props.onDone?.({ stored, copied });
  };

  useKeys((id) => {
    if (!value) return true;
    if (id === "c") {
      const v = value;
      tui.ctx?.clipboard
        .copy(v)
        .then(() => {
          tui.ctx?.clipboard.clearLater(v);
          setCopied(true);
          setConfirmClose(false);
        })
        .catch((e: Error) => setError(e.message));
      return true;
    }
    if (id === "s") {
      const ctx = tui.ctx;
      if (!ctx) return true;
      const target = generatedKeyRef(ctx.profile?.name ?? "env", props.name, props.hash);
      ctx.secrets
        .write(
          target,
          new Secret(value),
          `orctl ${ctx.profile?.name ?? "env"} key ${props.name}`.replace(/[^A-Za-z0-9 ._/-]/g, "-"),
        )
        .then(() => {
          setStored(target);
          setConfirmClose(false);
        })
        .catch((e: Error) => setError(e.message));
      return true;
    }
    if (id === "enter" || id === "escape") {
      close();
      return true;
    }
    return true;
  }, MODAL_CONTENT);

  return (
    <Modal
      title={props.title ?? "New key: shown once"}
      onClose={close}
      borderColor={theme.warn}
      width={96}
      height={12}
    >
      {props.note ? <text fg={theme.muted}>{props.note}</text> : null}
      <text fg={theme.fg}>{`Key "${props.name}"`}</text>
      <text fg={theme.warn} bg="#1c2230">
        {value ?? ""}
      </text>
      {stored ? <text fg={theme.good}>{`✔ stored → ${stored}`}</text> : null}
      {copied ? (
        <text fg={theme.good}>
          ✔ copied (cleared in 45 s if unchanged; clipboard history tools may keep it)
        </text>
      ) : null}
      {error ? <text fg={theme.bad}>{`✖ ${error}`}</text> : null}
      {confirmClose ? (
        <text fg={theme.bad}>
          Not copied or stored: it cannot be shown again. Press enter again to close anyway.
        </text>
      ) : null}
      <text fg={theme.dim}>c copy · s store in Keychain · enter done</text>
    </Modal>
  );
}
