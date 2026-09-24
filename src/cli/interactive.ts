import { createContext } from "../core/context.ts";
import { OrctlError } from "../core/errors.ts";
import { formatUsd } from "../core/format/money.ts";
import { messages } from "../core/messages.ts";
import { verifyKeys } from "../core/ops/profile.ts";
import { PROFILE_COLORS } from "../core/profile/schema.ts";
import { KEY_SHAPE, Secret } from "../core/secret.ts";
import { isSecretRef } from "../core/secrets/ref.ts";
import type { CommandSpec } from "../surface/spec.ts";
import type { CliDeps, GlobalOptions } from "./io.ts";
import { clackPrompter, type Prompter } from "./prompts.ts";

type KeySource = "paste" | "op" | "env" | "skip";

async function askKey(
  prompter: Prompter,
  role: "management" | "user",
  platform: string,
): Promise<{ ref?: string; secret?: Secret } | null> {
  const title = role === "management" ? "Management key" : "User key";
  const options: Array<{ value: KeySource; label: string; hint?: string }> = [
    ...(platform === "darwin" ? [{ value: "paste" as const, label: "Paste (stored in Keychain)" }] : []),
    { value: "op", label: "1Password reference", hint: "op://vault/item/field" },
    { value: "env", label: "Environment variable", hint: "env:VAR" },
    { value: "skip", label: "Skip" },
  ];
  const source = await prompter.select(`${title} source`, options, options[0]?.value);
  if (source === "skip") return null;
  if (source === "paste") {
    const value = await prompter.password(title, {
      validate: (v) =>
        KEY_SHAPE.test(v.trim()) ? undefined : "That does not look like an OpenRouter key (sk-or-…).",
    });
    return { secret: new Secret(value.trim()) };
  }
  const placeholder =
    source === "op" ? "op://Private/OpenRouter/management key" : "env:OPENROUTER_MANAGEMENT_KEY";
  const ref = await prompter.text(`${title} reference`, {
    placeholder,
    validate: (v) => (isSecretRef(v) ? undefined : "Expected op://…, env:VAR, file:… or keychain:…"),
  });
  return { ref: ref.trim() };
}

/**
 * The guided `profile add` flow (plan §6.8). Runs only on a terminal and only when no key flag
 * was given; everything it collects becomes ordinary op input, so it matches the flag path.
 */
async function completeProfileAdd(
  input: Record<string, unknown>,
  globals: GlobalOptions,
  deps: CliDeps,
): Promise<Record<string, unknown>> {
  const hasKey = ["mgmtKeyRef", "mgmtKeySecret", "userKeyRef", "userKeySecret"].some(
    (k) => input[k] !== undefined,
  );
  if (hasKey) return input;
  const prompter = deps.prompter ?? clackPrompter;
  const platform = deps.platform ?? process.platform;
  const out = { ...input };
  prompter.note(messages.managementKeyOrigin, `New profile "${String(input.name)}"`);

  const mgmt = await askKey(prompter, "management", platform);
  if (mgmt?.secret) out.mgmtKeySecret = mgmt.secret;
  if (mgmt?.ref) out.mgmtKeyRef = mgmt.ref;

  let workspaces: string[] = [];
  if (mgmt && input.verify !== false) {
    const ctx = await createContext(deps, { config: globals.config, timeoutSeconds: 20 });
    const spin = prompter.spinner();
    spin.start("Verifying management key");
    const secret = mgmt.secret ?? (await ctx.secrets.resolve(mgmt.ref as string));
    const v = await verifyKeys(ctx, { management: secret }, String(input.name));
    if (v.management?.ok) {
      const c = v.management.credits;
      spin.stop(`Verified: management role · credits ${formatUsd(c.total)} / used ${formatUsd(c.used)}`);
      workspaces = v.management.workspaces?.names ?? [];
    } else {
      spin.stop(
        `Verification failed: ${v.management && !v.management.ok ? v.management.error.message : "unknown"}`,
      );
      const keep = await prompter.confirm("Save anyway (--no-verify)?", false);
      if (!keep) throw new OrctlError("USAGE", "Cancelled; nothing was saved.");
      out.verify = false;
    }
  }

  if (await prompter.confirm("Add a user (inference) key for whoami/limits?", false)) {
    const user = await askKey(prompter, "user", platform);
    if (user?.secret) out.userKeySecret = user.secret;
    if (user?.ref) out.userKeyRef = user.ref;
  }
  if (!out.mgmtKeySecret && !out.mgmtKeyRef && !out.userKeySecret && !out.userKeyRef) {
    throw new OrctlError("USAGE", "A profile needs at least one key.", {
      hint: messages.managementKeyOrigin,
    });
  }
  if (out.workspace === undefined && workspaces.length > 1) {
    out.workspace = await prompter.select(
      "Default workspace",
      workspaces.map((w) => ({ value: w, label: w })),
      workspaces.includes("default") ? "default" : workspaces[0],
    );
  }
  if (out.color === undefined) {
    out.color = await prompter.select(
      "Color",
      PROFILE_COLORS.map((c) => ({ value: c, label: c })),
      "green",
    );
  }
  if (out.default === undefined) out.default = await prompter.confirm("Make default?", true);
  return out;
}

/**
 * The plaintext of a new key is returned once, so without --store/--show/--copy a terminal user
 * is asked where it should go (plan §8.1); scripts must pass a flag.
 */
async function completeDelivery(
  input: Record<string, unknown>,
  deps: CliDeps,
): Promise<Record<string, unknown>> {
  if (input.store || input.show || input.copy) return input;
  const prompter = deps.prompter ?? clackPrompter;
  const mac = (deps.platform ?? process.platform) === "darwin";
  const choice = await prompter.select(
    "Where should the new key go? (it is shown only once)",
    [
      ...(mac ? [{ value: "store" as const, label: "Store in the Keychain" }] : []),
      { value: "show" as const, label: "Show it once here" },
      { value: "copy" as const, label: "Copy to the clipboard (cleared after 45 s)" },
    ],
    mac ? "store" : "show",
  );
  return { ...input, [choice]: true };
}

export async function completeInteractively(
  spec: CommandSpec,
  input: Record<string, unknown>,
  globals: GlobalOptions,
  deps: CliDeps,
): Promise<Record<string, unknown>> {
  const interactive = deps.stdinIsTTY && deps.stdoutIsTTY && !globals.json;
  if (!interactive) return input;
  if (spec.op === "profile.add") return completeProfileAdd(input, globals, deps);
  if (spec.op === "keys.create" || spec.op === "keys.rotate") return completeDelivery(input, deps);
  return input;
}
