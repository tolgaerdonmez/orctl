import { decodePasteBytes } from "@opentui/core";
import { usePaste } from "@opentui/react";
import { useRef, useState } from "react";
import { isPrintable } from "../keymap.ts";
import { Layer, useKeys } from "../state.tsx";
import { theme } from "../theme.ts";

/**
 * Single-line text field. While focused it claims printable keys in the router so screen and
 * global shortcuts do not fire while typing; the OpenTUI input itself receives the keystrokes.
 */
export function TextField(props: {
  focused: boolean;
  placeholder?: string;
  initial?: string;
  label?: string;
  width?: number;
  onChange?(value: string): void;
  onSubmit?(value: string): void;
  onEscape?(): void;
  priority?: number;
}) {
  const valueRef = useRef(props.initial ?? "");
  useKeys(
    (id, key) => {
      if (id === "escape") {
        props.onEscape?.();
        return true;
      }
      if (id === "tab" || id === "shift+tab" || id === "up" || id === "down" || id === "ctrl+c") return false;
      return (
        isPrintable(key) ||
        ["backspace", "delete", "left", "right", "home", "end", "enter", "space"].includes(id)
      );
    },
    props.priority ?? Layer.INPUT,
    props.focused,
  );
  return (
    <box flexDirection="row" height={1}>
      {props.label ? <text fg={props.focused ? theme.accent : theme.muted}>{`${props.label} `}</text> : null}
      <input
        focused={props.focused}
        placeholder={props.placeholder ?? ""}
        value={props.initial ?? ""}
        width={props.width ?? 40}
        backgroundColor={props.focused ? "#1c2230" : undefined}
        textColor={theme.fg}
        onInput={(v: unknown) => {
          valueRef.current = typeof v === "string" ? v : valueRef.current;
          props.onChange?.(valueRef.current);
        }}
        onSubmit={(v: unknown) => props.onSubmit?.(typeof v === "string" ? v : valueRef.current)}
      />
    </box>
  );
}

/**
 * Masked secret entry: shows one dot per character and never renders the value (plan §6.8, §9 S5).
 * Keys and bracketed paste are captured directly; the value lives in a ref, not in React state.
 */
export function SecretField(props: {
  focused: boolean;
  label?: string;
  onSubmit(value: string): void;
  onEscape?(): void;
  priority?: number;
}) {
  const value = useRef("");
  const [length, setLength] = useState(0);
  const set = (v: string) => {
    value.current = v;
    setLength(v.length);
  };
  useKeys(
    (id, key) => {
      if (id === "escape") {
        props.onEscape?.();
        return true;
      }
      if (id === "enter") {
        const v = value.current.trim();
        set("");
        props.onSubmit(v);
        return true;
      }
      if (id === "backspace") {
        set(value.current.slice(0, -1));
        return true;
      }
      if (id === "ctrl+u") {
        set("");
        return true;
      }
      if (isPrintable(key)) {
        set(value.current + key.sequence);
        return true;
      }
      return id !== "ctrl+c";
    },
    props.priority ?? Layer.INPUT,
    props.focused,
  );
  usePaste((event) => {
    if (!props.focused) return;
    set(
      value.current +
        decodePasteBytes(event.bytes)
          .replace(/[\r\n]+/g, "")
          .trim(),
    );
  });
  const shown = length > 0 ? "•".repeat(Math.min(length, 48)) : "";
  return (
    <box flexDirection="row" height={1}>
      {props.label ? <text fg={props.focused ? theme.accent : theme.muted}>{`${props.label} `}</text> : null}
      <text
        fg={theme.fg}
        bg="#1c2230"
      >{`${shown}${props.focused ? "▏" : ""}${length > 48 ? ` (${length})` : ""}`}</text>
    </box>
  );
}

/** Vertical choice list with arrow/enter handling. */
export function ChoiceList<T extends string>(props: {
  options: Array<{ value: T; label: string; hint?: string }>;
  selected: number;
  onMove(index: number): void;
  onChoose(value: T): void;
  focused: boolean;
  priority?: number;
}) {
  useKeys(
    (id) => {
      const n = props.options.length;
      if (id === "up" || id === "k") {
        props.onMove((props.selected - 1 + n) % n);
        return true;
      }
      if (id === "down" || id === "j") {
        props.onMove((props.selected + 1) % n);
        return true;
      }
      if (id === "enter") {
        const opt = props.options[props.selected];
        if (opt) props.onChoose(opt.value);
        return true;
      }
      return false;
    },
    props.priority ?? Layer.SCREEN,
    props.focused,
  );
  return (
    <box flexDirection="column">
      {props.options.map((o, i) => (
        <text
          key={o.value}
          fg={i === props.selected ? theme.selectionFg : theme.fg}
          bg={i === props.selected ? theme.selectionBg : undefined}
        >
          {`${i === props.selected ? "›" : " "} ${o.label}`}
          {o.hint ? <span fg={theme.muted}>{`  ${o.hint}`}</span> : null}
        </text>
      ))}
    </box>
  );
}
