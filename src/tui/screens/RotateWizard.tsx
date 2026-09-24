import { useState } from "react";
import { mapError } from "../../core/client/map-error.ts";
import { forkContext } from "../../core/context.ts";
import type { OrctlError } from "../../core/errors.ts";
import { formatUsd } from "../../core/format/money.ts";
import { formatDay } from "../../core/format/time.ts";
import { shortLabel } from "../../core/format/views-keys.ts";
import type { KeyItem } from "../../core/ops/keys.ts";
import {
  executeRotation,
  planRotation,
  type RotationResult,
  type RotationStepEvent,
} from "../../core/ops/rotate.ts";
import { ChoiceList, TextField } from "../components/fields.tsx";
import { SecretReveal } from "../components/SecretReveal.tsx";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";
import { invalidateKeys } from "./KeyForm.tsx";

type Stage = "plan" | "expires" | "delivery" | "confirm" | "running" | "done" | "failed";
type Delivery = "store" | "show" | "copy";

const STATUS_MARK: Record<RotationStepEvent["status"], string> = {
  running: "…",
  done: "✔",
  failed: "✖",
  skipped: "–",
};

/**
 * RotateWizard (plan §7.3, §8.1): (1) plan, (2) delivery target, (3) confirmation (typed name when
 * the old key will be deleted), (4) live step list, (5) result. It runs the same executor as
 * `orctl keys rotate`, so journal, rollback and verification behave identically.
 */
export function RotateWizard(props: { hash: string }) {
  const tui = useTui();
  const key = useOp<KeyItem>("keys.show", { ref: props.hash });
  const [stage, setStage] = useState<Stage>("plan");
  const [choice, setChoice] = useState(0);
  const [expires, setExpires] = useState<string | undefined>(undefined);
  const [keepOld, setKeepOld] = useState(false);
  const [deleteOld, setDeleteOld] = useState(false);
  const [delivery, setDelivery] = useState<Delivery>("store");
  const [typed, setTyped] = useState("");
  const [steps, setSteps] = useState<RotationStepEvent[]>([]);
  const [result, setResult] = useState<RotationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const now = tui.ctx?.clock.now() ?? new Date();
  let planError: string | null = null;
  let plan: ReturnType<typeof planRotation> | null = null;
  if (key.data) {
    try {
      plan = planRotation(key.data, { expires, keepOldEnabled: keepOld, deleteOld }, now);
    } catch (err) {
      planError = (err as OrctlError).message;
    }
  }
  const input = {
    ref: key.data?.name ?? props.hash.slice(0, 12),
    ...(expires ? { expires } : {}),
    ...(delivery === "store"
      ? { store: true as const }
      : delivery === "show"
        ? { show: true as const }
        : { copy: true as const }),
    ...(keepOld ? { keepOldEnabled: true } : {}),
    ...(deleteOld ? { deleteOld: true } : {}),
  };
  useCliHint("keys.rotate", input);

  const run = async () => {
    const ctx = tui.ctx;
    if (!ctx || !key.data) return;
    setStage("running");
    setSteps([]);
    try {
      const res = await executeRotation(
        forkContext(ctx),
        { ...input, ref: key.data.hash, verify: true },
        (e) =>
          setSteps((list) => {
            const i = list.findIndex((x) => x.step === e.step);
            return i >= 0 ? list.map((x, j) => (j === i ? e : x)) : [...list, e];
          }),
      );
      setResult(res);
      setStage("done");
      await invalidateKeys(tui);
      if (res.key) {
        tui.openModal(
          <SecretReveal
            plaintext={res.key}
            name={res.new.name}
            hash={res.new.hash}
            title="Rotated key: shown once"
          />,
        );
      }
    } catch (err) {
      setError(mapError(err).message + (mapError(err).hint ? `\n${mapError(err).hint}` : ""));
      setStage("failed");
      await invalidateKeys(tui);
    }
  };

  useKeys((id) => {
    if (stage === "running") return true;
    if (id === "escape") {
      if (stage === "delivery" || stage === "confirm" || stage === "expires") setStage("plan");
      else tui.pop();
      return true;
    }
    if (stage === "plan") {
      if (id === "k") {
        setKeepOld((v) => !v);
        if (!keepOld) setDeleteOld(false);
        return true;
      }
      if (id === "d") {
        setDeleteOld((v) => !v);
        if (!deleteOld) setKeepOld(false);
        return true;
      }
      if (id === "x") {
        setStage("expires");
        return true;
      }
      if (id === "enter" && plan) {
        setChoice(0);
        setStage("delivery");
        return true;
      }
    }
    if (stage === "confirm" && !deleteOld && (id === "y" || id === "enter")) {
      void run();
      return true;
    }
    if ((stage === "done" || stage === "failed") && id === "enter") {
      tui.pop();
      return true;
    }
    return false;
  });

  const k = key.data;
  return (
    <Panel title={k ? `Rotate ${k.name}` : "Rotate key"}>
      {key.isLoading ? <text fg={theme.muted}>Loading…</text> : null}
      {key.error ? <text fg={theme.bad}>{`✖ ${key.error.message}`}</text> : null}
      {k && plan ? (
        <box flexDirection="column">
          <text fg={theme.accent}>1 Plan</text>
          <text
            fg={theme.fg}
          >{`  old key      ${k.name} (${shortLabel(k.label)}) · workspace ${k.workspaceSlug}`}</text>
          <text fg={theme.fg}>
            {`  new key      same name · ${k.limit === null ? "no limit" : `limit ${formatUsd(k.limit)}${k.limitReset ? ` ${k.limitReset}` : ""}`}${k.includeByokInLimit ? " · BYOK" : ""}`}
          </text>
          <text fg={theme.fg}>
            {`  expires      ${plan.expiresAt ? formatDay(plan.expiresAt) : "never"}${plan.expiresReason === "same-lifetime" ? " (same lifetime as old)" : ""}   x change`}
          </text>
          <text fg={theme.fg}>
            {`  old key then ${deleteOld ? "DELETED" : keepOld ? `renamed to "${plan.oldRename}" (kept enabled)` : `disabled and renamed to "${plan.oldRename}"`}   k keep enabled · d delete`}
          </text>
          {plan.warnings.map((w) => (
            <text key={w} fg={theme.warn}>{`  ! ${w}`}</text>
          ))}
        </box>
      ) : null}
      {planError ? <text fg={theme.bad}>{`✖ ${planError}`}</text> : null}
      {stage === "plan" ? <text fg={theme.dim}>enter continue · esc cancel</text> : null}
      {stage === "expires" ? (
        <TextField
          focused
          label="New expiry"
          placeholder="30d, 2027-12-31, ISO; empty = same lifetime"
          initial={expires ?? ""}
          width={44}
          onSubmit={(v) => {
            setExpires(v.trim() || undefined);
            setStage("plan");
          }}
          onEscape={() => setStage("plan")}
        />
      ) : null}
      {stage === "delivery" ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.accent}>2 Where should the new key go?</text>
          <ChoiceList
            focused
            options={[
              {
                value: "store",
                label: "Store in the Keychain",
                hint: "the profile's own user key is updated in place",
              },
              { value: "show", label: "Show it once" },
              { value: "copy", label: "Copy to the clipboard" },
            ]}
            selected={choice}
            onMove={setChoice}
            onChoose={(v) => {
              setDelivery(v as Delivery);
              setStage("confirm");
            }}
          />
        </box>
      ) : null}
      {stage === "confirm" && k ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.accent}>3 Confirm</text>
          <text
            fg={theme.fg}
          >{`Rotate "${k.name}" in profile ${tui.profile?.name ?? "env"} / workspace ${k.workspaceSlug}?`}</text>
          {deleteOld ? (
            <>
              <text fg={theme.bad}>{`The old key will be deleted. Type "${k.name}" to confirm:`}</text>
              <TextField
                focused
                width={40}
                onChange={setTyped}
                onSubmit={(v) => {
                  if (v.trim() === k.name) void run();
                  else setError("Text did not match.");
                }}
                onEscape={() => setStage("plan")}
              />
              {typed && typed !== k.name && error ? <text fg={theme.bad}>{error}</text> : null}
            </>
          ) : (
            <text fg={theme.dim}>y confirm · esc back</text>
          )}
        </box>
      ) : null}
      {stage === "running" || stage === "done" || stage === "failed" ? (
        <box flexDirection="column" marginTop={1}>
          <text fg={theme.accent}>4 Progress</text>
          {steps.map((s) => (
            <text
              key={s.step}
              fg={s.status === "failed" ? theme.bad : s.status === "done" ? theme.good : theme.fg}
            >
              {`  ${STATUS_MARK[s.status]} ${s.step}${s.detail ? ` · ${s.detail}` : ""}`}
            </text>
          ))}
        </box>
      ) : null}
      {stage === "done" && result ? (
        <box flexDirection="column" marginTop={1}>
          <text
            fg={theme.good}
          >{`5 Done: new key ${shortLabel(result.new.label)}${result.storedAt ? ` stored → ${result.storedAt}` : result.copied ? " copied" : ""}`}</text>
          <text fg={theme.fg}>
            {`  old key ${result.old.deleted ? "deleted" : `renamed to "${result.old.renamedTo}"${result.old.disabled ? " and disabled" : ""}`}`}
          </text>
          <text fg={theme.dim}>enter back to keys</text>
        </box>
      ) : null}
      {stage === "failed" && error ? (
        <box flexDirection="column" marginTop={1}>
          {error.split("\n").map((l) => (
            <text key={l} fg={theme.bad}>
              {l}
            </text>
          ))}
          <text fg={theme.dim}>enter back to keys</text>
        </box>
      ) : null}
    </Panel>
  );
}
