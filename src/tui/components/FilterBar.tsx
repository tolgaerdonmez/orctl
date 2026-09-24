import { theme } from "../theme.ts";
import { TextField } from "./fields.tsx";

/**
 * `/` search line shared by list screens: inactive it shows the current query, active it is a
 * text field that filters as you type (enter or esc leaves it, keeping the query).
 */
export function FilterBar(props: {
  active: boolean;
  query: string;
  placeholder?: string;
  onChange(query: string): void;
  onDone(): void;
  right?: string;
}) {
  return (
    <box flexDirection="row" height={1}>
      {props.active ? (
        <TextField
          focused
          label="/"
          initial={props.query}
          placeholder={props.placeholder ?? "type to filter"}
          width={40}
          onChange={props.onChange}
          onSubmit={props.onDone}
          onEscape={props.onDone}
        />
      ) : (
        <text fg={props.query ? theme.fg : theme.dim} flexGrow={1}>
          {props.query ? `/ ${props.query}` : `/ ${props.placeholder ?? "filter"}`}
        </text>
      )}
      {props.right ? (
        <text fg={theme.dim} flexGrow={props.active ? 1 : 0} textAlign="right">
          {props.right}
        </text>
      ) : null}
    </box>
  );
}
