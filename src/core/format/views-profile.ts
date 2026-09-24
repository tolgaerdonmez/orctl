import type { DoctorCheck, WhoamiResult } from "../ops/auth.ts";
import type { ManagementProbe, ProbeFailure, UserProbe } from "../ops/probes.ts";
import type { ProfileVerification, ProfileView } from "../ops/profile.ts";
import type { Column } from "./columns.ts";
import { formatLimit, formatUsd } from "./money.ts";
import { formatDay } from "./time.ts";
import { glyph, kv, lines, type Style, table, type View } from "./view.ts";

type ProfileRow = ProfileView & { verification?: ProfileVerification };

function verifySummary(v: ProfileVerification | undefined): string {
  if (!v) return "";
  const part = (label: string, r: ManagementProbe | UserProbe | ProbeFailure | null) =>
    r === null ? "" : r.ok ? `${label} ${glyph.ok}` : `${label} ${glyph.fail} ${r.error.code}`;
  return [part("M", v.management), part("U", v.user)].filter(Boolean).join("  ");
}

export const profileColumns: Column<ProfileRow>[] = [
  { id: "current", header: "", value: (r) => (r.current ? glyph.dot : ""), priority: 0, minWidth: 1 },
  { id: "name", header: "NAME", value: (r) => (r.ephemeral ? `${r.name} (env)` : r.name), priority: 0 },
  { id: "label", header: "LABEL", value: (r) => r.label ?? "", priority: 2 },
  { id: "color", header: "COLOR", value: (r) => r.color ?? "", priority: 4, optional: true },
  { id: "management", header: "MANAGEMENT KEY", value: (r) => r.management_key ?? "—", priority: 1 },
  { id: "user", header: "USER KEY", value: (r) => r.user_key ?? "—", priority: 3 },
  { id: "workspace", header: "WORKSPACE", value: (r) => r.workspace ?? "", priority: 3 },
  { id: "default", header: "DEFAULT", value: (r) => (r.default ? "yes" : ""), priority: 2 },
  {
    id: "verified",
    header: "VERIFIED",
    value: (r) => verifySummary(r.verification),
    priority: 1,
    tone: (r) => {
      const v = r.verification;
      if (!v) return undefined;
      return [v.management, v.user].some((x) => x && !x.ok) ? "bad" : "good";
    },
  },
];

function managementLine(m: WhoamiResult["management"], s: Style): string {
  if (!m) return s.dim("not configured");
  if (!m.ok) return `${m.ref}  ${s.tone("bad", `${glyph.fail} ${m.error.message}`)}`;
  const c = m.credits;
  return `${m.ref}  ${s.tone("good", `${glyph.ok} role verified`)} · credits ${formatUsd(c.total)} · used ${formatUsd(c.used)} · left ${formatUsd(c.remaining)}`;
}

function userLine(u: WhoamiResult["user"], s: Style): string {
  if (!u) return s.dim("not configured");
  if (!u.ok) return `${u.ref}  ${s.tone("bad", `${glyph.fail} ${u.error.message}`)}`;
  const limit =
    u.limit === null
      ? "no limit"
      : `limit ${formatUsd(u.limit)}${u.limitReset ? ` ${u.limitReset}` : ""} · left ${formatUsd(u.limitRemaining)}`;
  const free = `free-tier ${u.isFreeTier ? "yes" : "no"}`;
  return `${u.ref}  ${s.tone("good", glyph.ok)} ${u.label} · ${limit} · ${free}`;
}

function verificationLines(v: ProfileVerification | null, s: Style): string[] {
  if (!v) return [s.dim("Not verified (--no-verify).")];
  const out: string[] = [];
  if (v.management?.ok) {
    const c = v.management.credits;
    out.push(
      `${s.tone("good", glyph.ok)} Verified: management role · credits ${formatUsd(c.total)} / used ${formatUsd(c.used)}`,
    );
  }
  if (v.user?.ok)
    out.push(
      `${s.tone("good", glyph.ok)} Verified: user key ${v.user.label} · ${formatLimit(v.user.limit, v.user.limitRemaining)}`,
    );
  return out;
}

function profileDetail(p: ProfileView, s: Style): string[] {
  return kv(
    [
      [
        "Profile",
        `${s.color(p.color, p.name)}${p.label ? ` · "${p.label}"` : ""}${p.ephemeral ? " (ephemeral, from environment)" : ""}`,
      ],
      ["Management", p.management_key ?? "—"],
      ["User key", p.user_key ?? "—"],
      ["Workspace", p.workspace ?? "—"],
      ["Color", p.color ?? "—"],
      ["Default", p.default ? "yes" : "no"],
      ["Active", p.current ? `yes (selected via ${p.source})` : "no"],
    ],
    s,
  );
}

interface SavedProfile {
  name: string;
  profile: ProfileView;
  verification: ProfileVerification | null;
  stored: string[];
}

export const profileViews: Record<string, View> = {
  "profile.list": table<{ profiles: ProfileRow[] }, ProfileRow>({
    rows: (o) => o.profiles,
    columns: profileColumns,
    empty: "No profiles. Create one with `orctl profile add <name>`.",
  }),
  "profile.show": lines<ProfileView>((p, s) => profileDetail(p, s)),
  "profile.add": lines<SavedProfile>((o, s) => [
    ...verificationLines(o.verification, s),
    `${s.tone("good", glyph.ok)} Saved profile "${o.name}"${o.stored.length ? ` (secret ${glyph.arrow} ${o.stored.join(", ")})` : ""}`,
    ...(o.profile.default ? [s.dim(`"${o.name}" is the default profile.`)] : []),
  ]),
  "profile.set": lines<SavedProfile>((o, s) => [
    ...(o.verification ? verificationLines(o.verification, s) : []),
    `${s.tone("good", glyph.ok)} Updated profile "${o.name}"${o.stored.length ? ` (secret ${glyph.arrow} ${o.stored.join(", ")})` : ""}`,
  ]),
  "profile.use": lines<{ current: string; previous: string | null }>((o, s) => [
    `${s.tone("good", glyph.ok)} Active profile: ${o.current}${o.previous && o.previous !== o.current ? s.dim(` (was ${o.previous})`) : ""}`,
  ]),
  "profile.rename": lines<{ from: string; to: string; moved: Array<{ from: string; to: string }> }>(
    (o, s) => [
      `${s.tone("good", glyph.ok)} Renamed profile "${o.from}" ${glyph.arrow} "${o.to}"`,
      ...o.moved.map((m) => s.dim(`  moved ${m.from} ${glyph.arrow} ${m.to}`)),
    ],
  ),
  "profile.remove": lines<{ removed: string; purged: string[] }>((o, s) => [
    `${s.tone("good", glyph.ok)} Removed profile "${o.removed}"`,
    ...o.purged.map((r) => s.dim(`  deleted ${r}`)),
  ]),
  "auth.whoami": lines<WhoamiResult>((o, s) => {
    const p = o.profile;
    const rows: Array<[string, string]> = [
      [
        "Profile",
        `${s.color(p.color, p.name)} (selected via ${p.source})${p.label ? ` · "${p.label}"` : ""}`,
      ],
      ["Management", managementLine(o.management, s)],
      ["User key", userLine(o.user, s)],
    ];
    if (o.management?.ok && o.management.workspaces) {
      rows.push([
        "Workspaces",
        `${o.management.workspaces.count} visible · default: ${p.workspace ?? "default"}`,
      ]);
    }
    if (o.user?.ok && o.user.expiresAt) rows.push(["Key expires", formatDay(o.user.expiresAt)]);
    return kv(rows, s);
  }),
  "auth.doctor": lines<{ checks: DoctorCheck[]; summary: { ok: number; warn: number; fail: number } }>(
    (o, s) => {
      const mark = (c: DoctorCheck) =>
        c.status === "ok"
          ? s.tone("good", glyph.ok)
          : c.status === "warn"
            ? s.tone("warn", glyph.warn)
            : c.status === "fail"
              ? s.tone("bad", glyph.fail)
              : s.dim(glyph.skip);
      const out: string[] = [];
      for (const c of o.checks) {
        out.push(`${mark(c)} ${c.message}`);
        if (c.hint && c.status !== "ok") out.push(s.dim(`    ${c.hint}`));
      }
      out.push("", s.bold(`${o.summary.ok} ok · ${o.summary.warn} warnings · ${o.summary.fail} failures`));
      return out;
    },
  ),
};
