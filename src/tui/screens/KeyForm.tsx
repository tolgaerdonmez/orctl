import { useState } from "react";
import type { OrctlError } from "../../core/errors.ts";
import type { KeyItem } from "../../core/ops/keys.ts";
import { TextField } from "../components/fields.tsx";
import { SecretReveal } from "../components/SecretReveal.tsx";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";
import type { KeysResult } from "./Keys.tsx";

const RESETS = ["none", "daily", "weekly", "monthly"] as const;

type Row =
  | { kind: "text"; field: "name" | "limit" | "expires"; label: string; placeholder: string }
  | { kind: "cycle"; field: "reset" | "workspace"; label: string }
  | { kind: "toggle"; field: "includeByokInLimit"; label: string }
  | { kind: "submit"; label: string };

export async function invalidateKeys(tui: ReturnType<typeof useTui>): Promise<void> {
  await tui.queryClient.invalidateQueries({
    predicate: (q) => {
      const op = String(q.queryKey[1] ?? "");
      return op.startsWith("keys.") || op === "credits.get";
    },
  });
}

/**
 * KeyForm (plan §7.3): `n` creates a key (same fields as `orctl keys create`), `e` edits one
 * (`orctl keys update`). A created key goes straight to the SecretReveal dialog.
 */
export function KeyForm(props: { mode: "create" | "edit"; hash?: string }) {
  const tui = useTui();
  const editing = props.mode === "edit";
  const existing = useOp<KeyItem>(
    "keys.show",
    { ref: props.hash ?? "" },
    { enabled: editing && Boolean(props.hash) },
  );
  const list = useOp<KeysResult>("keys.list", {}, { enabled: !editing });
  const workspaces = [
    "(profile default)",
    ...Array.from(new Set((list.data?.keys ?? []).map((k) => k.workspaceSlug))).sort(),
  ];
  const [values, setValues] = useState<Record<string, string>>({});
  const [reset, setReset] = useState<(typeof RESETS)[number] | undefined>(undefined);
  const [wsIndex, setWsIndex] = useState(0);
  const [byok, setByok] = useState<boolean | undefined>(undefined);
  const [row, setRow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows: Row[] = editing
    ? [
        { kind: "text", field: "name", label: "Name", placeholder: existing.data?.name ?? "" },
        { kind: "text", field: "limit", label: "Limit USD", placeholder: "number, or none" },
        { kind: "cycle", field: "reset", label: "Reset" },
        { kind: "toggle", field: "includeByokInLimit", label: "Include BYOK" },
        { kind: "submit", label: "Save" },
      ]
    : [
        { kind: "text", field: "name", label: "Name", placeholder: "ci-bot" },
        { kind: "text", field: "limit", label: "Limit USD", placeholder: "empty = no limit" },
        { kind: "cycle", field: "reset", label: "Reset" },
        {
          kind: "text",
          field: "expires",
          label: "Expires",
          placeholder: "30d, 2027-12-31 or ISO; empty = never",
        },
        { kind: "cycle", field: "workspace", label: "Workspace" },
        { kind: "toggle", field: "includeByokInLimit", label: "Include BYOK" },
        { kind: "submit", label: "Create" },
      ];

  const input = (): Record<string, unknown> => {
    const limitRaw = values.limit?.trim();
    const limit = limitRaw ? (limitRaw.toLowerCase() === "none" ? null : Number(limitRaw)) : undefined;
    const ws = wsIndex > 0 ? workspaces[wsIndex] : undefined;
    if (editing) {
      return {
        ref: props.hash,
        ...(values.name?.trim() && values.name.trim() !== existing.data?.name
          ? { rename: values.name.trim() }
          : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(reset ? { reset } : {}),
        ...(byok !== undefined ? { includeByokInLimit: byok } : {}),
      };
    }
    return {
      name: values.name?.trim(),
      ...(typeof limit === "number" ? { limit } : {}),
      ...(reset && reset !== "none" ? { reset } : {}),
      ...(values.expires?.trim() ? { expires: values.expires.trim() } : {}),
      ...(ws ? { workspace: ws } : {}),
      ...(byok ? { includeByokInLimit: true } : {}),
    };
  };
  const cliInput = editing ? input() : { ...input(), store: true };
  useCliHint(editing ? "keys.update" : "keys.create", cliInput);

  const submit = async () => {
    const data = input();
    if (!editing && !data.name) return setError("A name is required.");
    if (typeof data.limit === "number" && !Number.isFinite(data.limit))
      return setError("Limit must be a number.");
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await tui.runOp("keys.update", data);
        tui.toast("Key updated", "good");
        await invalidateKeys(tui);
        tui.pop();
        return;
      }
      const res = await tui.runOp<{ apiKey: KeyItem; key: string }>("keys.create", { ...data, show: true });
      await invalidateKeys(tui);
      tui.pop();
      tui.openModal(
        <SecretReveal
          plaintext={res.key}
          name={res.apiKey.name}
          hash={res.apiKey.hash}
          onDone={(r) =>
            tui.toast(
              r.stored ? `Stored in ${r.stored}` : r.copied ? "Key copied" : "Key closed without saving",
              r.stored || r.copied ? "good" : "warn",
            )
          }
        />,
      );
    } catch (err) {
      setError((err as OrctlError).message);
    } finally {
      setBusy(false);
    }
  };

  useKeys((id) => {
    const current = rows[row];
    if (id === "escape") {
      tui.pop();
      return true;
    }
    if (id === "up" || id === "down" || id === "tab") {
      setRow((r) => (id === "up" ? (r - 1 + rows.length) % rows.length : (r + 1) % rows.length));
      return true;
    }
    if (current?.kind === "cycle" && (id === "left" || id === "right" || id === "space" || id === "enter")) {
      const dir = id === "left" ? -1 : 1;
      if (current.field === "reset") {
        const i = reset ? RESETS.indexOf(reset) : 0;
        setReset(RESETS[(i + dir + RESETS.length) % RESETS.length]);
      } else setWsIndex((i) => (i + dir + workspaces.length) % workspaces.length);
      return true;
    }
    if (current?.kind === "toggle" && (id === "space" || id === "enter")) {
      setByok((v) => !(v ?? existing.data?.includeByokInLimit ?? false));
      return true;
    }
    if (current?.kind === "submit" && id === "enter" && !busy) {
      void submit();
      return true;
    }
    return false;
  });

  const title = editing ? `Edit key ${existing.data?.name ?? ""}` : "New key";
  return (
    <Panel title={title}>
      {rows.map((r, i) => {
        const focused = i === row;
        const label = `${r.label}`.padEnd(14);
        if (r.kind === "text") {
          return (
            <TextField
              key={r.field}
              focused={focused}
              label={label}
              placeholder={r.placeholder}
              initial={values[r.field] ?? ""}
              width={44}
              onChange={(v) => setValues((s) => ({ ...s, [r.field]: v }))}
              onSubmit={() => setRow((x) => (x + 1) % rows.length)}
              onEscape={tui.pop}
            />
          );
        }
        const color = focused ? theme.selectionFg : theme.fg;
        const bg = focused ? theme.selectionBg : undefined;
        if (r.kind === "cycle") {
          const value =
            r.field === "reset"
              ? (reset ?? (editing ? (existing.data?.limitReset ?? "none") : "none"))
              : workspaces[wsIndex];
          return (
            <text key={r.field} fg={color} bg={bg}>
              {`${label} ‹ ${value} ›`}
            </text>
          );
        }
        if (r.kind === "toggle") {
          const on = byok ?? existing.data?.includeByokInLimit ?? false;
          return (
            <text key={r.field} fg={color} bg={bg}>
              {`${label} [${on ? "x" : " "}]`}
            </text>
          );
        }
        return (
          <text key="submit" fg={focused ? theme.selectionFg : theme.accent} bg={bg} marginTop={1}>
            {busy ? "  Working…" : `  ${r.label}  `}
          </text>
        );
      })}
      {error ? <text fg={theme.bad}>{`✖ ${error}`}</text> : null}
      <text fg={theme.dim} marginTop={1}>
        ↑↓ move · ←→ change · space toggle · enter next/submit · esc cancel
      </text>
      {!editing ? (
        <text fg={theme.dim}>The key is shown once after creation; copy it or store it in the Keychain.</text>
      ) : null}
    </Panel>
  );
}
