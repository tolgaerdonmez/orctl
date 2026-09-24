import { useEffect, useState } from "react";
import { forkContext } from "../../core/context.ts";
import type { OrctlError } from "../../core/errors.ts";
import { formatUsd } from "../../core/format/money.ts";
import { messages } from "../../core/messages.ts";
import { verifyKeys } from "../../core/ops/profile.ts";
import { PROFILE_COLORS, PROFILE_NAME } from "../../core/profile/schema.ts";
import { KEY_SHAPE, Secret } from "../../core/secret.ts";
import { isSecretRef } from "../../core/secrets/ref.ts";
import { ChoiceList, SecretField, TextField } from "../components/fields.tsx";
import { Panel } from "../components/Shell.tsx";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { profileHex, theme } from "../theme.ts";

type Role = "management" | "user";
type Step =
  | { kind: "name" }
  | { kind: "label" }
  | { kind: "source"; role: Role }
  | { kind: "secret"; role: Role }
  | { kind: "ref"; role: Role }
  | { kind: "verifying" }
  | { kind: "verify-failed"; message: string }
  | { kind: "ask-user" }
  | { kind: "workspace" }
  | { kind: "workspace-text" }
  | { kind: "color" }
  | { kind: "default" }
  | { kind: "key-action"; role: Role }
  | { kind: "saving" }
  | { kind: "save-failed"; message: string };

type Draft = Record<string, unknown>;

const secretField = (role: Role) => (role === "management" ? "mgmtKeySecret" : "userKeySecret");
const refField = (role: Role) => (role === "management" ? "mgmtKeyRef" : "userKeyRef");
const roleTitle = (role: Role) => (role === "management" ? "Management key" : "User key");

/**
 * Profile add/edit wizard (plan §6.8): the same steps as `orctl profile add`, ending in the same
 * profile.add / profile.set operation. The key is typed into a masked field and verified before
 * anything is saved.
 */
export function ProfileWizard(props: { mode: "add" | "edit"; name?: string }) {
  const tui = useTui();
  const editing = props.mode === "edit";
  const existing = editing && props.name ? tui.ctx?.store : undefined;
  const [draft, setDraft] = useState<Draft>(editing ? { name: props.name } : {});
  const [step, setStep] = useState<Step>(editing ? { kind: "label" } : { kind: "name" });
  const [choice, setChoice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [verifiedNote, setVerifiedNote] = useState<string | null>(null);
  const [initial, setInitial] = useState<{ label?: string; color?: string; workspace?: string }>({});
  const op = editing ? "profile.set" : "profile.add";
  useCliHint(op, draft);

  useEffect(() => {
    if (!existing || !props.name) return;
    void existing.loadConfig().then((c) => {
      const p = c.config.profiles[props.name as string];
      if (p) setInitial({ label: p.label, color: p.color, workspace: p.workspace });
    });
  }, [existing, props.name]);

  const go = (next: Step) => {
    setChoice(0);
    setError(null);
    setStep(next);
  };
  const update = (patch: Draft) => setDraft((d) => ({ ...d, ...patch }));

  useKeys((id) => {
    if (id === "escape" && step.kind !== "saving") {
      tui.pop();
      return true;
    }
    return false;
  });

  const afterManagement = (d: Draft) => {
    if (editing) return go({ kind: "key-action", role: "user" });
    if (d.mgmtKeySecret || d.mgmtKeyRef) return void verifyManagement(d);
    return go({ kind: "ask-user" });
  };

  const verifyManagement = async (d: Draft) => {
    go({ kind: "verifying" });
    const ctx = tui.ctx;
    if (!ctx) return;
    try {
      const fork = forkContext(ctx);
      const secret =
        (d.mgmtKeySecret as Secret | undefined) ?? (await fork.secrets.resolve(String(d.mgmtKeyRef)));
      const v = await verifyKeys(fork, { management: secret }, String(d.name));
      if (v.management?.ok) {
        const c = v.management.credits;
        setVerifiedNote(
          `✔ Verified: management role · credits ${formatUsd(c.total)} / used ${formatUsd(c.used)}`,
        );
        setWorkspaces(v.management.workspaces?.names ?? []);
        go({ kind: "ask-user" });
      } else {
        go({
          kind: "verify-failed",
          message: v.management && !v.management.ok ? v.management.error.message : "unknown",
        });
      }
    } catch (err) {
      go({ kind: "verify-failed", message: (err as OrctlError).message });
    }
  };

  const save = async (d: Draft) => {
    go({ kind: "saving" });
    try {
      await tui.runOp(op, d);
      tui.toast(editing ? `Updated profile ${String(d.name)}` : `Saved profile ${String(d.name)}`, "good");
      await tui.reload();
      tui.pop();
    } catch (err) {
      go({ kind: "save-failed", message: (err as OrctlError).message });
    }
  };

  const afterUser = (d: Draft) => {
    if (editing) return void save(d);
    if (!d.mgmtKeySecret && !d.mgmtKeyRef && !d.userKeySecret && !d.userKeyRef) {
      setError("A profile needs at least one key.");
      return go({ kind: "source", role: "management" });
    }
    if (workspaces.length > 1) return go({ kind: "workspace" });
    return go({ kind: "color" });
  };

  const body = (() => {
    switch (step.kind) {
      case "name":
        return (
          <TextField
            focused
            label="Profile name"
            placeholder="personal"
            onEscape={tui.pop}
            onSubmit={(v) => {
              const name = v.trim();
              if (!PROFILE_NAME.test(name)) return setError("Use a-z, 0-9, _ and -, max 32 characters.");
              update({ name });
              go({ kind: "source", role: "management" });
            }}
          />
        );
      case "label":
        return (
          <TextField
            focused
            label="Label"
            initial={initial.label ?? ""}
            onEscape={tui.pop}
            onSubmit={(v) => {
              if (v.trim() !== (initial.label ?? "")) update({ label: v.trim() });
              go({ kind: "color" });
            }}
          />
        );
      case "source": {
        const options = [
          ...(tui.deps.platform === "darwin" || !tui.deps.platform
            ? [{ value: "paste", label: "Paste (stored in Keychain)" }]
            : []),
          { value: "op", label: "1Password reference", hint: "op://vault/item/field" },
          { value: "env", label: "Environment variable", hint: "env:VAR" },
          { value: "skip", label: "Skip" },
        ];
        return (
          <>
            <text fg={theme.muted}>{`${roleTitle(step.role)} source`}</text>
            <ChoiceList
              focused
              options={options}
              selected={choice}
              onMove={setChoice}
              onChoose={(v) => {
                if (v === "skip")
                  return step.role === "management" ? afterManagement(draft) : afterUser(draft);
                if (v === "paste") return go({ kind: "secret", role: step.role });
                go({ kind: "ref", role: step.role });
              }}
            />
          </>
        );
      }
      case "secret":
        return (
          <>
            <SecretField
              focused
              label={roleTitle(step.role)}
              onEscape={() => go({ kind: "source", role: step.role })}
              onSubmit={(value) => {
                if (!KEY_SHAPE.test(value))
                  return setError("That does not look like an OpenRouter key (sk-or-…).");
                const d = {
                  ...draft,
                  [secretField(step.role)]: new Secret(value),
                  [refField(step.role)]: undefined,
                };
                setDraft(d);
                step.role === "management" ? afterManagement(d) : afterUser(d);
              }}
            />
            <text fg={theme.dim}>
              Paste the key and press enter. It is stored in the Keychain, never shown.
            </text>
          </>
        );
      case "ref":
        return (
          <TextField
            focused
            label={`${roleTitle(step.role)} reference`}
            placeholder="op://Private/OpenRouter/credential"
            width={48}
            onEscape={() => go({ kind: "source", role: step.role })}
            onSubmit={(v) => {
              if (!isSecretRef(v.trim())) return setError("Expected op://…, env:VAR, file:… or keychain:…");
              const d = { ...draft, [refField(step.role)]: v.trim(), [secretField(step.role)]: undefined };
              setDraft(d);
              step.role === "management" ? afterManagement(d) : afterUser(d);
            }}
          />
        );
      case "verifying":
        return <text fg={theme.accent}>Verifying management key…</text>;
      case "verify-failed":
        return (
          <>
            <text fg={theme.bad}>{`✖ Verification failed: ${step.message}`}</text>
            <ChoiceList
              focused
              options={[
                { value: "fix", label: "Fix the key" },
                { value: "save", label: "Keep it without verifying (--no-verify)" },
              ]}
              selected={choice}
              onMove={setChoice}
              onChoose={(v) => {
                if (v === "fix") return go({ kind: "source", role: "management" });
                update({ verify: false });
                go({ kind: "ask-user" });
              }}
            />
          </>
        );
      case "ask-user":
        return (
          <>
            <text fg={theme.muted}>Add a user (inference) key for whoami/limits?</text>
            <ChoiceList
              focused
              options={[
                { value: "no", label: "No" },
                { value: "yes", label: "Yes" },
              ]}
              selected={choice}
              onMove={setChoice}
              onChoose={(v) => (v === "yes" ? go({ kind: "source", role: "user" }) : afterUser(draft))}
            />
          </>
        );
      case "workspace":
        return (
          <>
            <text fg={theme.muted}>Default workspace</text>
            <ChoiceList
              focused
              options={workspaces.map((w) => ({ value: w, label: w }))}
              selected={choice}
              onMove={setChoice}
              onChoose={(v) => {
                update({ workspace: v });
                go({ kind: "color" });
              }}
            />
          </>
        );
      case "workspace-text":
        return (
          <TextField
            focused
            label="Default workspace"
            initial={initial.workspace ?? ""}
            onEscape={tui.pop}
            onSubmit={(v) => {
              if (v.trim() && v.trim() !== (initial.workspace ?? "")) update({ workspace: v.trim() });
              go({ kind: "key-action", role: "management" });
            }}
          />
        );
      case "color":
        return (
          <>
            <text fg={theme.muted}>Color</text>
            <ChoiceList
              focused
              options={PROFILE_COLORS.map((c) => ({ value: c, label: c }))}
              selected={choice}
              onMove={setChoice}
              onChoose={(v) => {
                if (!editing || v !== initial.color) update({ color: v });
                go(editing ? { kind: "workspace-text" } : { kind: "default" });
              }}
            />
          </>
        );
      case "default":
        return (
          <>
            <text fg={theme.muted}>Make default?</text>
            <ChoiceList
              focused
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              selected={choice}
              onMove={setChoice}
              onChoose={(v) => {
                const d = { ...draft, default: v === "yes" ? true : undefined };
                setDraft(d);
                void save(d);
              }}
            />
          </>
        );
      case "key-action":
        return (
          <>
            <text fg={theme.muted}>{roleTitle(step.role)}</text>
            <ChoiceList
              focused
              options={[
                { value: "keep", label: "Keep as is" },
                { value: "paste", label: "Replace (paste, stored in Keychain)" },
                { value: "ref", label: "Replace with a reference" },
                { value: "remove", label: "Remove" },
              ]}
              selected={choice}
              onMove={setChoice}
              onChoose={(v) => {
                if (v === "paste") return go({ kind: "secret", role: step.role });
                if (v === "ref") return go({ kind: "ref", role: step.role });
                const d =
                  v === "remove"
                    ? { ...draft, [step.role === "management" ? "mgmtKey" : "userKey"]: false }
                    : draft;
                setDraft(d);
                step.role === "management" ? go({ kind: "key-action", role: "user" }) : void save(d);
              }}
            />
          </>
        );
      case "saving":
        return <text fg={theme.accent}>Saving…</text>;
      case "save-failed":
        return (
          <>
            <text fg={theme.bad}>{`✖ ${step.message}`}</text>
            <ChoiceList
              focused
              options={[
                { value: "retry-unverified", label: "Save without verifying (--no-verify)" },
                { value: "back", label: "Start over" },
                { value: "cancel", label: "Cancel" },
              ]}
              selected={choice}
              onMove={setChoice}
              onChoose={(v) => {
                if (v === "cancel") return tui.pop();
                if (v === "back")
                  return go(editing ? { kind: "label" } : { kind: "source", role: "management" });
                const d = { ...draft, verify: false };
                setDraft(d);
                void save(d);
              }}
            />
          </>
        );
    }
  })();

  const summary: string[] = [];
  if (draft.name) summary.push(`name        ${String(draft.name)}`);
  if (draft.mgmtKeySecret)
    summary.push(`management  (pasted → keychain:orctl/${String(draft.name)}/management)`);
  if (draft.mgmtKeyRef) summary.push(`management  ${String(draft.mgmtKeyRef)}`);
  if (draft.mgmtKey === false) summary.push("management  (remove)");
  if (draft.userKeySecret) summary.push(`user key    (pasted → keychain:orctl/${String(draft.name)}/user)`);
  if (draft.userKeyRef) summary.push(`user key    ${String(draft.userKeyRef)}`);
  if (draft.userKey === false) summary.push("user key    (remove)");
  if (draft.label) summary.push(`label       ${String(draft.label)}`);
  if (draft.workspace) summary.push(`workspace   ${String(draft.workspace)}`);
  if (draft.color) summary.push(`color       ${String(draft.color)}`);

  return (
    <Panel title={editing ? `Edit profile ${props.name}` : "Add profile"}>
      {!editing ? <text fg={theme.dim}>{messages.managementKeyOrigin}</text> : null}
      <box flexDirection="column" marginTop={1}>
        {summary.map((l) => (
          <text key={l} fg={l.startsWith("color") ? profileHex(String(draft.color)) : theme.muted}>
            {l}
          </text>
        ))}
        {verifiedNote ? <text fg={theme.good}>{verifiedNote}</text> : null}
      </box>
      <box flexDirection="column" marginTop={1}>
        {body}
      </box>
      {error ? <text fg={theme.bad}>{error}</text> : null}
      <text fg={theme.dim} marginTop={1}>
        enter confirm · ↑↓ choose · esc back
      </text>
    </Panel>
  );
}
