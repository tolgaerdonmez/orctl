import * as clack from "@clack/prompts";
import { OrctlError } from "../core/errors.ts";
import { messages } from "../core/messages.ts";

/**
 * Interactive CLI questions (plan K5). Only used when stdin and stdout are terminals; without a
 * TTY orctl never asks and instead requires flags. Tests inject a scripted Prompter.
 */
export interface Prompter {
  text(
    message: string,
    opts?: { placeholder?: string; initial?: string; validate?: (v: string) => string | undefined },
  ): Promise<string>;
  password(message: string, opts?: { validate?: (v: string) => string | undefined }): Promise<string>;
  select<T extends string>(
    message: string,
    options: Array<{ value: T; label: string; hint?: string }>,
    initial?: T,
  ): Promise<T>;
  confirm(message: string, initial?: boolean): Promise<boolean>;
  note(message: string, title?: string): void;
  spinner(): { start(msg: string): void; stop(msg: string): void };
}

function unwrap<T>(value: T | symbol): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new OrctlError("USAGE", "Cancelled.");
  return value as Exclude<T, symbol>;
}

export const clackPrompter: Prompter = {
  async text(message, opts = {}) {
    return unwrap(
      await clack.text({
        message,
        placeholder: opts.placeholder,
        initialValue: opts.initial,
        validate: opts.validate ? (v) => opts.validate?.(v ?? "") : undefined,
      }),
    );
  },
  async password(message, opts = {}) {
    return unwrap(
      await clack.password({
        message,
        validate: opts.validate ? (v) => opts.validate?.(v ?? "") : undefined,
      }),
    );
  },
  async select(message, options, initial) {
    return unwrap(
      await clack.select({
        message,
        options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })) as never,
        initialValue: initial,
      }),
    ) as never;
  },
  async confirm(message, initial = false) {
    return unwrap(await clack.confirm({ message, initialValue: initial }));
  },
  note(message, title) {
    clack.note(message, title);
  },
  spinner() {
    const s = clack.spinner();
    return { start: (m) => s.start(m), stop: (m) => s.stop(m) };
  },
};

const DELIVERY_LABELS = {
  store: "Store in the Keychain",
  show: "Show it once here",
  copy: "Copy to the clipboard (cleared after 45 s)",
} as const;

/** Where a new key should go; its plaintext is returned only once (plan §8.1). */
export async function askDelivery<T extends keyof typeof DELIVERY_LABELS>(
  prompter: Prompter,
  choices: T[],
): Promise<T> {
  return prompter.select(
    "Where should the new key go? (it is shown only once)",
    choices.map((c) => ({ value: c, label: DELIVERY_LABELS[c] })),
    choices[0],
  );
}

/** Typed confirmation for destructive actions (plan §6.10). */
export async function confirmDestructive(prompter: Prompter, prompt: string, typed?: string): Promise<void> {
  if (typed) {
    const answer = await prompter.text(`${prompt}\n  Type "${typed}" to confirm`);
    if (answer.trim() !== typed) throw new OrctlError("USAGE", messages.typedConfirmMismatch);
    return;
  }
  if (!(await prompter.confirm(prompt, false)))
    throw new OrctlError("USAGE", "Cancelled; nothing was changed.");
}
