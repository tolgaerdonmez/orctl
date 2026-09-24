import { z } from "zod";
import { isSecretRef } from "../secrets/ref.ts";

/** Config and state schemas (plan §6.3). Unknown fields are preserved and reported by doctor. */

export const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const PROFILE_COLORS = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "gray"] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];

export const ProfileName = z
  .string()
  .regex(PROFILE_NAME, "profile names use a-z, 0-9, _ and -, start with a letter or digit, max 32 chars");

const SecretRefString = z.string().refine(isSecretRef, {
  message: "must be a secret reference (keychain:, op://, env: or file:)",
});

export const ProfileV1 = z.looseObject({
  label: z.string().max(64).optional(),
  color: z.enum(PROFILE_COLORS).optional(),
  management_key: SecretRefString.optional(),
  user_key: SecretRefString.optional(),
  workspace: z.string().min(1).max(128).optional(),
});
export type ProfileV1 = z.infer<typeof ProfileV1>;

export const KNOWN_PROFILE_FIELDS = new Set(["label", "color", "management_key", "user_key", "workspace"]);
export const KNOWN_CONFIG_FIELDS = new Set(["version", "default_profile", "profiles"]);

export const ConfigV1 = z
  .looseObject({
    version: z.literal(1),
    default_profile: ProfileName.optional(),
    profiles: z.record(ProfileName, ProfileV1).default({}),
  })
  .superRefine((cfg, issue) => {
    if (cfg.default_profile && !(cfg.default_profile in cfg.profiles)) {
      issue.addIssue({
        code: "custom",
        path: ["default_profile"],
        message: `default_profile "${cfg.default_profile}" does not name a profile`,
      });
    }
  });
export type ConfigV1 = z.infer<typeof ConfigV1>;

export const StateV1 = z.looseObject({
  version: z.literal(1).default(1),
  current_profile: z.string().optional(),
  profiles: z.record(z.string(), z.looseObject({ last_workspace: z.string().optional() })).default({}),
});
export type StateV1 = z.infer<typeof StateV1>;

export function emptyConfig(): ConfigV1 {
  return { version: 1, profiles: {} };
}

export function emptyState(): StateV1 {
  return { version: 1, profiles: {} };
}

/** Recursively finds string values that look like raw API keys (plan §9 S11). */
export function findRawKeys(value: unknown, path: string[] = []): string[] {
  if (typeof value === "string") return value.trim().startsWith("sk-or-") ? [path.join(".")] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findRawKeys(v, [...path, String(i)]));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => findRawKeys(v, [...path, k]));
  }
  return [];
}

/** Migration hook for future config versions; v1 is the only version today. */
export function migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.version === undefined) return { ...raw, version: 1 };
  return raw;
}
