import { z } from "zod";
import { errorFromJson, OrctlError, usageError } from "../errors.ts";
import { messages } from "../messages.ts";
import { EPHEMERAL_PROFILE, ephemeralProfile, type ProfileSource } from "../profile/resolve.ts";
import { type ConfigV1, PROFILE_COLORS, ProfileName, type ProfileV1 } from "../profile/schema.ts";
import { mapLimit } from "../runtime.ts";
import { Secret } from "../secret.ts";
import { defaultKeychainRef, type KeyRole, parseSecretRef } from "../secrets/ref.ts";
import {
  failure,
  type ManagementProbe,
  type ProbeFailure,
  prefixWarning,
  probeManagement,
  probeUser,
  type UserProbe,
} from "./probes.ts";
import { type Ctx, defineOp } from "./types.ts";

const SecretInput = z.instanceof(Secret);
const RefInput = z.string().refine((v) => {
  parseSecretRef(v);
  return true;
});
const Color = z.enum(PROFILE_COLORS);

export interface ProfileView {
  name: string;
  label: string | null;
  color: string | null;
  management_key: string | null;
  user_key: string | null;
  workspace: string | null;
  default: boolean;
  current: boolean;
  ephemeral: boolean;
  source: ProfileSource | null;
}

export interface ProfileVerification {
  management: ManagementProbe | ProbeFailure | null;
  user: UserProbe | ProbeFailure | null;
}

function viewOf(ctx: Ctx, config: ConfigV1, name: string, p: ProfileV1): ProfileView {
  const current = ctx.profile?.name === name && !ctx.profile.ephemeral;
  return {
    name,
    label: p.label ?? null,
    color: p.color ?? null,
    management_key: p.management_key ?? null,
    user_key: p.user_key ?? null,
    workspace: p.workspace ?? null,
    default: config.default_profile === name,
    current,
    ephemeral: false,
    source: current ? (ctx.profile?.source ?? null) : null,
  };
}

function ephemeralView(ctx: Ctx): ProfileView | null {
  const eph = ephemeralProfile(ctx.env);
  if (!eph) return null;
  return {
    name: EPHEMERAL_PROFILE,
    label: eph.label ?? null,
    color: eph.color ?? null,
    management_key: eph.managementRef ?? null,
    user_key: eph.userRef ?? null,
    workspace: eph.workspace ?? null,
    default: false,
    current: ctx.profile?.ephemeral === true,
    ephemeral: true,
    source: ctx.profile?.ephemeral ? ctx.profile.source : null,
  };
}

async function loadConfig(ctx: Ctx): Promise<ConfigV1> {
  return structuredClone((await ctx.store.loadConfig()).config);
}

function requireExisting(config: ConfigV1, name: string): ProfileV1 {
  const p = config.profiles[name];
  if (!p) {
    const names = Object.keys(config.profiles);
    throw new OrctlError("NOT_FOUND", messages.unknownProfile(name), {
      hint: names.length ? messages.availableProfiles(names) : messages.addProfileHint,
    });
  }
  return p;
}

/** Verifies the given keys against the server; any failure is reported per role. */
export async function verifyKeys(
  ctx: Ctx,
  keys: { management?: Secret | undefined; user?: Secret | undefined },
  profileName?: string,
): Promise<ProfileVerification> {
  const [management, user] = await Promise.all([
    keys.management
      ? probeManagement(ctx.sdk.withKey("management", keys.management), { withWorkspaces: true }).catch((e) =>
          failure(e, "management", profileName),
        )
      : Promise.resolve(null),
    keys.user
      ? probeUser(ctx.sdk.withKey("user", keys.user)).catch((e) => failure(e, "user", profileName))
      : Promise.resolve(null),
  ]);
  return { management, user };
}

interface KeyChange {
  ref?: string | undefined;
  secret?: Secret | undefined;
  remove?: boolean | undefined;
}

function keyChange(
  ref: string | undefined,
  secret: Secret | undefined,
  keep: boolean | undefined,
  flag: string,
): KeyChange | null {
  const given = [ref !== undefined, secret !== undefined, keep === false].filter(Boolean).length;
  if (given > 1) throw usageError(`Use only one of --${flag}-ref, --${flag}-stdin and --no-${flag}.`);
  if (ref !== undefined) return { ref };
  if (secret !== undefined) return { secret };
  if (keep === false) return { remove: true };
  return null;
}

/**
 * Applies management/user key changes for a profile: resolves referenced secrets, verifies them
 * (unless disabled), then stores raw secrets in the Keychain. Returns the refs to write.
 */
async function applyKeyChanges(
  ctx: Ctx,
  name: string,
  changes: Partial<Record<KeyRole, KeyChange | null>>,
  verify: boolean,
): Promise<{
  refs: Partial<Record<KeyRole, string | null>>;
  verification: ProfileVerification | null;
  stored: string[];
}> {
  const secrets: Partial<Record<KeyRole, Secret>> = {};
  for (const role of ["management", "user"] as const) {
    const change = changes[role];
    if (!change || change.remove) continue;
    // A reference is only resolved when it will be verified; --no-verify never touches it.
    const secret =
      change.secret ?? (change.ref && verify ? await ctx.secrets.resolve(change.ref) : undefined);
    if (!secret) continue;
    secrets[role] = secret;
    const warn = prefixWarning(role, secret);
    if (warn) ctx.meta.warnings.push(warn);
  }

  let verification: ProfileVerification | null = null;
  if (verify && (secrets.management || secrets.user)) {
    verification = await verifyKeys(ctx, secrets, name);
    for (const role of ["management", "user"] as const) {
      const result = verification[role];
      if (result && !result.ok) {
        throw errorFromJson(
          {
            ...result.error,
            hint: `${result.error.hint ? `${result.error.hint} ` : ""}Pass --no-verify to save it anyway.`,
          },
          `${role} key verification failed: `,
        );
      }
    }
    if (verification.user?.ok && verification.user.isManagementKey)
      ctx.meta.warnings.push(messages.userKeyIsManagement);
  }

  const refs: Partial<Record<KeyRole, string | null>> = {};
  const stored: string[] = [];
  for (const role of ["management", "user"] as const) {
    const change = changes[role];
    if (!change) continue;
    if (change.remove) {
      refs[role] = null;
      continue;
    }
    if (change.ref) {
      refs[role] = change.ref;
      continue;
    }
    const secret = secrets[role];
    if (!secret) continue;
    const target = defaultKeychainRef(name, role);
    await ctx.secrets.write(target, secret, `orctl ${name} ${role}`);
    stored.push(target);
    refs[role] = target;
  }
  return { refs, verification, stored };
}

function setOrDelete<K extends keyof ProfileV1>(
  p: ProfileV1,
  key: K,
  value: ProfileV1[K] | null | undefined,
) {
  if (value === undefined) return;
  if (value === null) delete p[key];
  else p[key] = value;
}

// ---------------------------------------------------------------------------------------------

export const profileList = defineOp({
  id: "profile.list",
  role: "local",
  kind: "read",
  summary: "List profiles",
  input: z.object({ verify: z.boolean().optional() }),
  async run(ctx, input) {
    const config = (await ctx.store.loadConfig()).config;
    const profiles: Array<ProfileView & { verification?: ProfileVerification }> = Object.entries(
      config.profiles,
    ).map(([name, p]) => viewOf(ctx, config, name, p));
    const eph = ephemeralView(ctx);
    if (eph) profiles.push(eph);
    if (input.verify) {
      const results = await mapLimit(profiles, ctx.limiter, async (p) => {
        const keys = {
          management: p.management_key
            ? await ctx.secrets.resolve(p.management_key).catch(() => undefined)
            : undefined,
          user: p.user_key ? await ctx.secrets.resolve(p.user_key).catch(() => undefined) : undefined,
        };
        const v = await verifyKeys(ctx, keys, p.name);
        if (p.management_key && !keys.management) {
          v.management = failure(
            new OrctlError("NO_CREDENTIAL", `Could not resolve ${p.management_key}.`),
            "management",
          );
        }
        if (p.user_key && !keys.user) {
          v.user = failure(new OrctlError("NO_CREDENTIAL", `Could not resolve ${p.user_key}.`), "user");
        }
        return v;
      });
      results.forEach((r, i) => {
        const target = profiles[i];
        if (target && r.status === "fulfilled") target.verification = r.value;
      });
    }
    return { profiles, current: ctx.profile?.name ?? null };
  },
});

export const profileShow = defineOp({
  id: "profile.show",
  role: "local",
  kind: "read",
  summary: "Show one profile (the active one by default)",
  input: z.object({ name: z.string().optional() }),
  async run(ctx, input) {
    const config = (await ctx.store.loadConfig()).config;
    const name = input.name ?? ctx.profile?.name;
    if (!name) throw new OrctlError("NOT_FOUND", messages.noProfile, { hint: messages.addProfileHint });
    if (name === EPHEMERAL_PROFILE && !config.profiles[name]) {
      const eph = ephemeralView(ctx);
      if (eph) return eph;
    }
    return viewOf(ctx, config, name, requireExisting(config, name));
  },
});

export const profileAdd = defineOp({
  id: "profile.add",
  role: "local",
  kind: "mutate",
  summary: "Add a profile (an OpenRouter account)",
  input: z.object({
    name: ProfileName,
    mgmtKeyRef: RefInput.optional(),
    mgmtKeySecret: SecretInput.optional(),
    userKeyRef: RefInput.optional(),
    userKeySecret: SecretInput.optional(),
    label: z.string().max(64).optional(),
    color: Color.optional(),
    workspace: z.string().min(1).optional(),
    default: z.boolean().optional(),
    verify: z.boolean().default(true),
  }),
  async run(ctx, input) {
    if (input.name === EPHEMERAL_PROFILE) {
      throw usageError(`"${EPHEMERAL_PROFILE}" is reserved for the ephemeral ORCTL_MANAGEMENT_KEY profile.`);
    }
    const config = await loadConfig(ctx);
    if (config.profiles[input.name]) {
      throw usageError(
        `Profile "${input.name}" already exists.`,
        `Change it with \`orctl profile set ${input.name} …\`.`,
      );
    }
    const mgmt = keyChange(input.mgmtKeyRef, input.mgmtKeySecret, undefined, "mgmt-key");
    const user = keyChange(input.userKeyRef, input.userKeySecret, undefined, "user-key");
    if (!mgmt && !user) {
      throw usageError(
        "A profile needs at least one key: --mgmt-key-stdin / --mgmt-key-ref (recommended) or --user-key-*.",
        messages.managementKeyOrigin,
      );
    }
    const { refs, verification, stored } = await applyKeyChanges(
      ctx,
      input.name,
      { management: mgmt, user },
      input.verify,
    );
    if (input.workspace && verification?.management?.ok && verification.management.workspaces) {
      const known = verification.management.workspaces.names;
      if (!known.includes(input.workspace)) {
        ctx.meta.warnings.push(
          `Workspace "${input.workspace}" was not found by slug (known: ${known.join(", ") || "none"}).`,
        );
      }
    }
    const profile: ProfileV1 = {};
    setOrDelete(profile, "label", input.label);
    setOrDelete(profile, "color", input.color);
    setOrDelete(profile, "management_key", refs.management ?? undefined);
    setOrDelete(profile, "user_key", refs.user ?? undefined);
    setOrDelete(profile, "workspace", input.workspace);
    config.profiles[input.name] = profile;
    const isFirst = Object.keys(config.profiles).length === 1;
    if (input.default || isFirst || !config.default_profile) config.default_profile = input.name;
    await ctx.store.saveConfig(config, input.name);
    return {
      name: input.name,
      profile: viewOf(ctx, config, input.name, profile),
      verification,
      stored,
    };
  },
});

export const profileSet = defineOp({
  id: "profile.set",
  role: "local",
  kind: "mutate",
  summary: "Change a profile's label, color, workspace or keys",
  input: z.object({
    name: ProfileName,
    label: z.string().max(64).optional(),
    color: Color.optional(),
    workspace: z.string().min(1).optional(),
    mgmtKeyRef: RefInput.optional(),
    mgmtKeySecret: SecretInput.optional(),
    mgmtKey: z.boolean().optional(),
    userKeyRef: RefInput.optional(),
    userKeySecret: SecretInput.optional(),
    userKey: z.boolean().optional(),
    default: z.boolean().optional(),
    verify: z.boolean().default(true),
  }),
  async run(ctx, input) {
    const config = await loadConfig(ctx);
    const profile = requireExisting(config, input.name);
    const mgmt = keyChange(input.mgmtKeyRef, input.mgmtKeySecret, input.mgmtKey, "mgmt-key");
    const user = keyChange(input.userKeyRef, input.userKeySecret, input.userKey, "user-key");
    const { refs, verification, stored } = await applyKeyChanges(
      ctx,
      input.name,
      { management: mgmt, user },
      input.verify,
    );
    setOrDelete(profile, "label", input.label);
    setOrDelete(profile, "color", input.color);
    setOrDelete(profile, "workspace", input.workspace);
    if (refs.management !== undefined) setOrDelete(profile, "management_key", refs.management);
    if (refs.user !== undefined) setOrDelete(profile, "user_key", refs.user);
    if (input.default) config.default_profile = input.name;
    await ctx.store.saveConfig(config, input.name);
    return { name: input.name, profile: viewOf(ctx, config, input.name, profile), verification, stored };
  },
});

export const profileUse = defineOp({
  id: "profile.use",
  role: "local",
  kind: "mutate",
  summary: "Switch the active profile",
  input: z.object({ name: z.string() }),
  async run(ctx, input) {
    const config = (await ctx.store.loadConfig()).config;
    requireExisting(config, input.name);
    let previous: string | null = null;
    await ctx.store.updateState((state) => {
      previous = state.current_profile ?? null;
      state.current_profile = input.name;
    });
    if (ctx.env.ORCTL_PROFILE && ctx.env.ORCTL_PROFILE !== input.name) {
      ctx.meta.warnings.push(`ORCTL_PROFILE=${ctx.env.ORCTL_PROFILE} still takes precedence in this shell.`);
    }
    if (ephemeralProfile(ctx.env) && !ctx.env.ORCTL_PROFILE) {
      ctx.meta.warnings.push(
        "ORCTL_MANAGEMENT_KEY/ORCTL_USER_KEY are set and take precedence over the active profile.",
      );
    }
    return { current: input.name, previous };
  },
});

function renamedRef(ref: string | undefined, from: string, to: string): string | undefined {
  if (!ref) return undefined;
  for (const role of ["management", "user"] as const) {
    if (ref === defaultKeychainRef(from, role)) return defaultKeychainRef(to, role);
  }
  return undefined;
}

export const profileRename = defineOp({
  id: "profile.rename",
  role: "local",
  kind: "mutate",
  summary: "Rename a profile (moves its Keychain items)",
  input: z.object({ name: z.string(), newName: ProfileName }),
  async run(ctx, input) {
    const config = await loadConfig(ctx);
    const profile = requireExisting(config, input.name);
    if (config.profiles[input.newName]) throw usageError(`Profile "${input.newName}" already exists.`);
    if (input.newName === EPHEMERAL_PROFILE) throw usageError(`"${EPHEMERAL_PROFILE}" is reserved.`);
    const moved: Array<{ from: string; to: string }> = [];
    for (const [field, role] of [
      ["management_key", "management"],
      ["user_key", "user"],
    ] as const) {
      const target = renamedRef(profile[field], input.name, input.newName);
      const source = profile[field];
      if (!target || !source) continue;
      // read → write → delete, so a failure part-way never loses the key
      const secret = await ctx.secrets.resolve(source);
      await ctx.secrets.write(target, secret, `orctl ${input.newName} ${role}`);
      profile[field] = target;
      moved.push({ from: source, to: target });
    }
    delete config.profiles[input.name];
    config.profiles[input.newName] = profile;
    if (config.default_profile === input.name) config.default_profile = input.newName;
    await ctx.store.saveConfig(config, input.newName);
    for (const m of moved) await ctx.secrets.delete(m.from).catch(() => false);
    await ctx.store.updateState((state) => {
      if (state.current_profile === input.name) state.current_profile = input.newName;
      const entry = state.profiles[input.name];
      if (entry) {
        state.profiles[input.newName] = entry;
        delete state.profiles[input.name];
      }
    });
    return { from: input.name, to: input.newName, moved };
  },
});

export const profileRemove = defineOp({
  id: "profile.remove",
  role: "local",
  kind: "destructive",
  summary: "Remove a profile",
  input: z.object({ name: z.string(), purgeSecrets: z.boolean().optional() }),
  async confirm(ctx, input) {
    const config = (await ctx.store.loadConfig()).config;
    const p = requireExisting(config, input.name);
    const refs = [p.management_key, p.user_key].filter(Boolean).join(", ") || "no keys";
    return {
      prompt: `Remove profile "${input.name}"${p.label ? ` (${p.label})` : ""}${input.purgeSecrets ? ` and delete its Keychain items (${refs})` : ""}?`,
      typed: input.name,
    };
  },
  async run(ctx, input) {
    const config = await loadConfig(ctx);
    const profile = requireExisting(config, input.name);
    delete config.profiles[input.name];
    if (config.default_profile === input.name) {
      const rest = Object.keys(config.profiles);
      if (rest.length === 1) config.default_profile = rest[0];
      else delete config.default_profile;
    }
    await ctx.store.saveConfig(config);
    const purged: string[] = [];
    const kept: string[] = [];
    for (const ref of [profile.management_key, profile.user_key]) {
      if (!ref) continue;
      if (input.purgeSecrets && ref.startsWith("keychain:")) {
        if (await ctx.secrets.delete(ref)) purged.push(ref);
      } else kept.push(ref);
    }
    if (input.purgeSecrets && kept.length) {
      ctx.meta.warnings.push(`Not deleted (orctl only deletes Keychain items): ${kept.join(", ")}`);
    }
    await ctx.store.updateState((state) => {
      if (state.current_profile === input.name) delete state.current_profile;
      delete state.profiles[input.name];
    });
    return { removed: input.name, purged, kept };
  },
});
