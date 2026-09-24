import { z } from "zod";
import { mapError } from "../client/map-error.ts";
import { ExitCode, OrctlError } from "../errors.ts";
import { fileMode, formatMode } from "../fs-util.ts";
import { messages } from "../messages.ts";
import { withTimeout } from "../runtime.ts";
import {
  failure,
  type ManagementProbe,
  type ProbeFailure,
  probeManagement,
  probeUser,
  type UserProbe,
} from "./probes.ts";
import { type Ctx, defineOp } from "./types.ts";

export interface WhoamiResult {
  profile: {
    name: string;
    source: string;
    label: string | null;
    color: string | null;
    workspace: string | null;
  };
  management: ({ ref: string } & (ManagementProbe | ProbeFailure)) | null;
  user: ({ ref: string } & (UserProbe | ProbeFailure)) | null;
}

/**
 * `orctl whoami` (plan §6.9, §8.6): management and user probes run in parallel, each with a 5 s
 * timeout; partial results are still shown. Key values are never shown, only references and the
 * server's masked label.
 */
export const authWhoami = defineOp({
  id: "auth.whoami",
  role: "management",
  kind: "read",
  summary: "Show who the active profile is, with credits and key limits",
  input: z.object({}),
  async run(ctx): Promise<WhoamiResult> {
    if (ctx.profileError) throw ctx.profileError;
    const profile = ctx.profile;
    if (!profile)
      throw new OrctlError("NO_CREDENTIAL", messages.noProfile, { hint: messages.addProfileHint });
    if (!profile.managementRef && !profile.userRef) {
      throw new OrctlError("NO_CREDENTIAL", `Profile "${profile.name}" has no keys.`, {
        hint: messages.missingRoleHint(profile.name, "management"),
      });
    }
    const [management, user] = await Promise.all([
      profile.managementRef
        ? probeManagement(ctx.sdk.management(), { withWorkspaces: true }).catch((e) =>
            failure(e, "management", profile.name),
          )
        : null,
      profile.userRef ? probeUser(ctx.sdk.user()).catch((e) => failure(e, "user", profile.name)) : null,
    ]);
    if (user?.ok && user.isManagementKey) ctx.meta.warnings.push(messages.userKeyIsManagement);
    const results = [management, user].filter((r) => r !== null);
    const failed = results.filter((r) => !r.ok) as ProbeFailure[];
    if (failed.length > 0 && failed.length === results.length && failed[0]) {
      const first = failed[0].error;
      throw new OrctlError(first.code, first.message, {
        hint: first.hint ?? undefined,
        httpStatus: first.http_status ?? undefined,
      });
    }
    for (const f of failed) ctx.meta.warnings.push(f.error.message);
    if (management?.ok && management.workspaces) ctx.meta.workspaces = management.workspaces.count;
    return {
      profile: {
        name: profile.name,
        source: profile.source,
        label: profile.label ?? null,
        color: profile.color ?? null,
        workspace: profile.workspace ?? null,
      },
      management: management && profile.managementRef ? { ref: profile.managementRef, ...management } : null,
      user: user && profile.userRef ? { ref: profile.userRef, ...user } : null,
    };
  },
});

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  message: string;
  hint?: string | undefined;
  /** Exit code this failure maps to (the first failing check decides doctor's exit code). */
  exit?: number | undefined;
}

/** Extra checks contributed by later features (cache, rotation journals); read-only by contract. */
export type DoctorContributor = (ctx: Ctx, input: { offline: boolean }) => Promise<DoctorCheck[]>;
const contributors: DoctorContributor[] = [];
export function registerDoctorCheck(fn: DoctorContributor): void {
  contributors.push(fn);
}

async function fileChecks(ctx: Ctx): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  let configOk = true;
  try {
    const loaded = await ctx.store.loadConfig();
    const writable = await ctx.store.isConfigWritable();
    if (!loaded.exists) {
      checks.push({
        id: "config",
        status: "warn",
        message: `No config at ${ctx.paths.configFile}.`,
        hint: messages.addProfileHint,
      });
    } else {
      const note = writable.writable
        ? ""
        : writable.reason === "nix"
          ? " (managed by Nix, read-only)"
          : " (symlink, read-only)";
      checks.push({ id: "config", status: "ok", message: `Config ${ctx.paths.configFile}${note}` });
      for (const w of loaded.warnings) checks.push({ id: "config", status: "warn", message: w });
    }
  } catch (err) {
    configOk = false;
    const e = mapError(err);
    checks.push({ id: "config", status: "fail", message: e.message, hint: e.hint, exit: e.exit });
  }
  const stateMode = await fileMode(ctx.paths.stateFile);
  if (stateMode === null)
    checks.push({ id: "state", status: "ok", message: `No state file yet (${ctx.paths.stateFile}).` });
  else if ((stateMode & 0o077) !== 0) {
    checks.push({
      id: "state",
      status: "warn",
      message: messages.loosePermissions(ctx.paths.stateFile, formatMode(stateMode)),
      hint: `chmod 600 ${ctx.paths.stateFile}`,
    });
  } else checks.push({ id: "state", status: "ok", message: `State ${ctx.paths.stateFile}` });
  if (!configOk) return checks;

  const config = (await ctx.store.loadConfig()).config;
  for (const [name, p] of Object.entries(config.profiles)) {
    for (const [role, ref] of [
      ["management", p.management_key],
      ["user", p.user_key],
    ] as const) {
      if (!ref) continue;
      try {
        await ctx.secrets.resolve(ref);
        checks.push({
          id: `secret:${name}:${role}`,
          status: "ok",
          message: `${name} ${role} key resolves (${ref})`,
        });
      } catch (err) {
        const e = mapError(err);
        checks.push({
          id: `secret:${name}:${role}`,
          status: "fail",
          message: `${name} ${role}: ${e.message}`,
          hint: e.hint,
          exit: e.exit,
        });
      }
    }
  }
  return checks;
}

function envChecks(ctx: Ctx): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  if (ctx.env.OPENROUTER_API_KEY)
    checks.push({ id: "env", status: "warn", message: messages.openRouterApiKeyIgnored });
  if (ctx.env.OPENROUTER_DEBUG)
    checks.push({ id: "env", status: "warn", message: messages.openRouterDebugSet });
  if (ctx.env.OPENROUTER_BASE_URL) {
    checks.push({
      id: "env",
      status: "warn",
      message: "OPENROUTER_BASE_URL is set but ignored; orctl always talks to openrouter.ai.",
    });
  }
  return checks;
}

async function networkChecks(ctx: Ctx, offline: boolean): Promise<DoctorCheck[]> {
  if (offline) return [{ id: "network", status: "skip", message: "Network checks skipped (--offline)." }];
  const checks: DoctorCheck[] = [];
  try {
    const res = await withTimeout(
      ctx.sdk.public().models.count(undefined, { retries: { strategy: "none" } }),
      5_000,
    );
    checks.push({
      id: "network",
      status: "ok",
      message: `openrouter.ai reachable (${res.data.count} models).`,
    });
  } catch (err) {
    const e = mapError(err);
    checks.push({ id: "network", status: "fail", message: e.message, hint: e.hint, exit: e.exit });
    return checks;
  }
  const profile = ctx.profile;
  if (!profile) return checks;
  if (profile.managementRef) {
    const r = await probeManagement(ctx.sdk.management()).catch((e) =>
      failure(e, "management", profile.name),
    );
    checks.push(
      r.ok
        ? { id: "role:management", status: "ok", message: `${profile.name}: management role verified.` }
        : {
            id: "role:management",
            status: "fail",
            message: `${profile.name}: ${r.error.message}`,
            hint: r.error.hint ?? undefined,
            exit: r.error.exit,
          },
    );
  }
  if (profile.userRef) {
    const r = await probeUser(ctx.sdk.user()).catch((e) => failure(e, "user", profile.name));
    checks.push(
      r.ok
        ? {
            id: "role:user",
            status: r.isManagementKey ? "warn" : "ok",
            message: r.isManagementKey
              ? `${profile.name}: ${messages.userKeyIsManagement}`
              : `${profile.name}: user key verified (${r.label}).`,
          }
        : {
            id: "role:user",
            status: "fail",
            message: `${profile.name}: ${r.error.message}`,
            hint: r.error.hint ?? undefined,
            exit: r.error.exit,
          },
    );
  }
  return checks;
}

export const authDoctor = defineOp({
  id: "auth.doctor",
  role: "local",
  kind: "read",
  summary: "Diagnose config, secrets, network and open rotations (read-only)",
  input: z.object({ offline: z.boolean().optional() }),
  async run(ctx, input) {
    const offline = Boolean(input.offline);
    const checks: DoctorCheck[] = [
      ...(await fileChecks(ctx)),
      ...envChecks(ctx),
      ...(await networkChecks(ctx, offline)),
    ];
    for (const contribute of contributors) checks.push(...(await contribute(ctx, { offline })));
    const failed = checks.find((c) => c.status === "fail");
    if (failed) ctx.meta.exit = failed.exit ?? ExitCode.UNEXPECTED;
    return {
      checks,
      summary: {
        ok: checks.filter((c) => c.status === "ok").length,
        warn: checks.filter((c) => c.status === "warn").length,
        fail: checks.filter((c) => c.status === "fail").length,
      },
    };
  },
});
