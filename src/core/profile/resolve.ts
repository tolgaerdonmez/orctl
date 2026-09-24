import { OrctlError } from "../errors.ts";
import { messages } from "../messages.ts";
import type { Env } from "../paths.ts";
import type { ConfigV1, ProfileColor, StateV1 } from "./schema.ts";

/** How the active profile was chosen; shown in JSON meta, banners and the TUI header (§6.6). */
export type ProfileSource = "flag" | "env" | "ephemeral-env" | "state" | "config" | "only";

export interface ResolvedProfile {
  name: string;
  source: ProfileSource;
  label?: string | undefined;
  color?: ProfileColor | undefined;
  managementRef?: string | undefined;
  userRef?: string | undefined;
  workspace?: string | undefined;
  /** The `env` profile built from ORCTL_MANAGEMENT_KEY / ORCTL_USER_KEY; never written to config. */
  ephemeral: boolean;
}

export const EPHEMERAL_PROFILE = "env";

export function fromConfig(config: ConfigV1, name: string, source: ProfileSource): ResolvedProfile {
  const p = config.profiles[name];
  if (!p) throw unknownProfile(name, config);
  return {
    name,
    source,
    label: p.label,
    color: p.color,
    managementRef: p.management_key,
    userRef: p.user_key,
    workspace: p.workspace,
    ephemeral: false,
  };
}

export function ephemeralProfile(env: Env): ResolvedProfile | null {
  const mgmt = env.ORCTL_MANAGEMENT_KEY;
  const user = env.ORCTL_USER_KEY;
  if (!mgmt && !user) return null;
  return {
    name: EPHEMERAL_PROFILE,
    source: "ephemeral-env",
    label: "environment",
    color: "yellow",
    managementRef: mgmt ? "env:ORCTL_MANAGEMENT_KEY" : undefined,
    userRef: user ? "env:ORCTL_USER_KEY" : undefined,
    workspace: env.ORCTL_WORKSPACE || undefined,
    ephemeral: true,
  };
}

export function unknownProfile(name: string, config: ConfigV1): OrctlError {
  const names = Object.keys(config.profiles);
  return new OrctlError("NO_CREDENTIAL", messages.unknownProfile(name), {
    hint: names.length ? messages.availableProfiles(names) : messages.addProfileHint,
  });
}

/**
 * Profile selection order (plan §6.6):
 *   1 --profile/-p   2 ORCTL_PROFILE   3 ORCTL_MANAGEMENT_KEY / ORCTL_USER_KEY (ephemeral `env`)
 *   4 state.json current_profile   5 config default_profile   6 the only profile   7 none
 * OPENROUTER_API_KEY is deliberately ignored so identities never mix silently.
 */
export function resolveProfile(input: {
  flag?: string | undefined;
  env: Env;
  config: ConfigV1;
  state: StateV1;
}): ResolvedProfile | null {
  const { flag, env, config, state } = input;
  if (flag) {
    if (flag === EPHEMERAL_PROFILE && !(flag in config.profiles)) {
      const eph = ephemeralProfile(env);
      if (eph) return { ...eph, source: "flag" };
    }
    return fromConfig(config, flag, "flag");
  }
  if (env.ORCTL_PROFILE) return fromConfig(config, env.ORCTL_PROFILE, "env");
  const eph = ephemeralProfile(env);
  if (eph) return eph;
  if (state.current_profile && state.current_profile in config.profiles) {
    return fromConfig(config, state.current_profile, "state");
  }
  if (config.default_profile && config.default_profile in config.profiles) {
    return fromConfig(config, config.default_profile, "config");
  }
  const names = Object.keys(config.profiles);
  if (names.length === 1 && names[0]) return fromConfig(config, names[0], "only");
  return null;
}
