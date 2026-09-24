import { useState } from "react";
import { useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";
import { TextField } from "./fields.tsx";
import { MODAL_CONTENT, Modal } from "./Modal.tsx";

/**
 * Typed confirmation for destructive actions (plan §6.10): the user types the exact name; the
 * prompt names the profile and workspace so the wrong account is obvious.
 */
export function ConfirmTyped(props: {
  title: string;
  prompt: string;
  typed: string;
  extra?: string;
  onConfirm(): void;
}) {
  const { closeModal } = useTui();
  const [mismatch, setMismatch] = useState(false);
  return (
    <Modal title={props.title} onClose={closeModal} borderColor={theme.bad} height={10} width={90}>
      <text fg={theme.fg}>{props.prompt}</text>
      {props.extra ? <text fg={theme.muted}>{props.extra}</text> : null}
      <text fg={theme.muted}>{`Type "${props.typed}" and press enter (esc cancels):`}</text>
      <TextField
        focused
        priority={MODAL_CONTENT}
        width={40}
        onEscape={closeModal}
        onSubmit={(v) => {
          if (v.trim() === props.typed) {
            closeModal();
            props.onConfirm();
          } else setMismatch(true);
        }}
      />
      {mismatch ? <text fg={theme.bad}>Text did not match; nothing was changed.</text> : null}
    </Modal>
  );
}

/** Yes/no confirmation for reversible actions. */
export function Confirm(props: { title: string; prompt: string; onConfirm(): void }) {
  const { closeModal } = useTui();
  return (
    <Modal title={props.title} onClose={closeModal} height={7} width={90}>
      <text fg={theme.fg}>{props.prompt}</text>
      <text fg={theme.muted}>y confirm · esc cancel</text>
      <ConfirmKeys
        onYes={() => {
          closeModal();
          props.onConfirm();
        }}
      />
    </Modal>
  );
}

function ConfirmKeys(props: { onYes(): void }) {
  useKeys((id) => {
    if (id === "y" || id === "enter") {
      props.onYes();
      return true;
    }
    return false;
  }, MODAL_CONTENT);
  return null;
}

/** Single text prompt in a modal (e.g. rename). */
export function PromptModal(props: {
  title: string;
  label: string;
  initial?: string;
  onSubmit(value: string): void;
}) {
  const { closeModal } = useTui();
  return (
    <Modal title={props.title} onClose={closeModal} height={6}>
      <text fg={theme.muted}>{props.label}</text>
      <TextField
        focused
        priority={MODAL_CONTENT}
        initial={props.initial}
        width={40}
        onEscape={closeModal}
        onSubmit={(v) => {
          closeModal();
          props.onSubmit(v.trim());
        }}
      />
    </Modal>
  );
}
