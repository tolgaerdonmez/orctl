import { PROFILE_COLORS } from "../core/profile/schema.ts";

/**
 * The CLI surface as data (plan §5.2): for each operation, its command path, positionals and the
 * flag ↔ input-field mapping. commander builds the command tree from this, the TUI uses it for
 * its "CLI equivalent" hint and palette, and the parity test round-trips it.
 */

export type FlagType =
  /** `--label <text>` */
  | "string"
  /** `--limit <usd>`; parsed with Number() */
  | "number"
  /** `--default` */
  | "boolean"
  /** `--no-verify` → field `verify` = false (absent means the schema default) */
  | "negatable"
  /** `--store [target]` → true, or the given string */
  | "optional-string"
  /** `--mgmt-key-stdin` → the secret read from stdin */
  | "stdin-secret";

export interface FlagSpec {
  /** Input field this flag fills. */
  field: string;
  /** commander flag syntax, e.g. "--limit <usd>" or "-w, --workspace <ref>". */
  flags: string;
  description: string;
  type: FlagType;
  choices?: readonly string[] | undefined;
  /** Custom string → value conversion (e.g. "none" → null). */
  parse?: ((raw: string) => unknown) | undefined;
  /** Inverse of parse for formatCli; defaults to String(value). */
  format?: ((value: unknown) => string) | undefined;
}

export interface PositionalSpec {
  field: string;
  name: string;
  required: boolean;
  description: string;
}

export interface CommandSpec {
  op: string;
  path: readonly string[];
  /** Extra paths that run the same op, e.g. ["whoami"] for ["auth","whoami"]. */
  aliases?: readonly (readonly string[])[] | undefined;
  description: string;
  positionals: readonly PositionalSpec[];
  flags: readonly FlagSpec[];
  /** Supports --csv and --columns. */
  list?: boolean | undefined;
  /** Honors --refresh / --offline (public cached data). */
  cached?: boolean | undefined;
  examples?: readonly string[] | undefined;
}

export const COLOR_CHOICES = PROFILE_COLORS;

const mgmtKeyFlags: FlagSpec[] = [
  {
    field: "mgmtKeyRef",
    flags: "--mgmt-key-ref <ref>",
    description: "management key reference (keychain:…, op://…, env:…, file:…)",
    type: "string",
  },
  {
    field: "mgmtKeySecret",
    flags: "--mgmt-key-stdin",
    description: "read the management key from stdin and store it in the Keychain",
    type: "stdin-secret",
  },
];

const userKeyFlags: FlagSpec[] = [
  {
    field: "userKeyRef",
    flags: "--user-key-ref <ref>",
    description: "user (inference) key reference",
    type: "string",
  },
  {
    field: "userKeySecret",
    flags: "--user-key-stdin",
    description: "read the user key from stdin and store it in the Keychain",
    type: "stdin-secret",
  },
];

const profileMetaFlags: FlagSpec[] = [
  { field: "label", flags: "--label <text>", description: "human-readable label", type: "string" },
  {
    field: "color",
    flags: "--color <color>",
    description: "header badge color",
    type: "string",
    choices: COLOR_CHOICES,
  },
  {
    field: "workspace",
    flags: "--workspace <ref>",
    description: "default workspace (slug or id)",
    type: "string",
  },
  { field: "default", flags: "--default", description: "make this the default profile", type: "boolean" },
];

export const PROFILE_SPECS: CommandSpec[] = [
  {
    op: "profile.list",
    path: ["profile", "list"],
    aliases: [["profile", "ls"]],
    description: "List profiles",
    positionals: [],
    flags: [
      { field: "verify", flags: "--verify", description: "probe every profile's keys", type: "boolean" },
    ],
    list: true,
  },
  {
    op: "profile.show",
    path: ["profile", "show"],
    description: "Show a profile (the active one by default)",
    positionals: [{ field: "name", name: "name", required: false, description: "profile name" }],
    flags: [],
  },
  {
    op: "profile.add",
    path: ["profile", "add"],
    description: "Add a profile for an OpenRouter account",
    positionals: [
      { field: "name", name: "name", required: true, description: "profile name (a-z, 0-9, _ -)" },
    ],
    flags: [
      ...mgmtKeyFlags,
      ...userKeyFlags,
      ...profileMetaFlags,
      {
        field: "verify",
        flags: "--no-verify",
        description: "save without verifying keys",
        type: "negatable",
      },
    ],
    examples: [
      "orctl profile add personal",
      "op read 'op://Private/OpenRouter/management key' | orctl profile add ci --mgmt-key-stdin --color yellow",
      'orctl profile add acme --mgmt-key-ref "op://Work/OpenRouter ACME/management key"',
    ],
  },
  {
    op: "profile.set",
    path: ["profile", "set"],
    description: "Change a profile's label, color, workspace or keys",
    positionals: [{ field: "name", name: "name", required: true, description: "profile name" }],
    flags: [
      ...profileMetaFlags,
      ...mgmtKeyFlags,
      {
        field: "mgmtKey",
        flags: "--no-mgmt-key",
        description: "remove the management key reference",
        type: "negatable",
      },
      ...userKeyFlags,
      {
        field: "userKey",
        flags: "--no-user-key",
        description: "remove the user key reference",
        type: "negatable",
      },
      {
        field: "verify",
        flags: "--no-verify",
        description: "save without verifying new keys",
        type: "negatable",
      },
    ],
  },
  {
    op: "profile.use",
    path: ["profile", "use"],
    description: "Switch the active profile",
    positionals: [{ field: "name", name: "name", required: true, description: "profile name" }],
    flags: [],
  },
  {
    op: "profile.rename",
    path: ["profile", "rename"],
    description: "Rename a profile (moves its Keychain items)",
    positionals: [
      { field: "name", name: "old", required: true, description: "current name" },
      { field: "newName", name: "new", required: true, description: "new name" },
    ],
    flags: [],
  },
  {
    op: "profile.remove",
    path: ["profile", "rm"],
    aliases: [["profile", "remove"]],
    description: "Remove a profile",
    positionals: [{ field: "name", name: "name", required: true, description: "profile name" }],
    flags: [
      {
        field: "purgeSecrets",
        flags: "--purge-secrets",
        description: "also delete its Keychain items",
        type: "boolean",
      },
    ],
  },
];

export const AUTH_SPECS: CommandSpec[] = [
  {
    op: "auth.whoami",
    path: ["whoami"],
    aliases: [["auth", "whoami"]],
    description: "Show the active profile, verified roles, credits and key limits",
    positionals: [],
    flags: [],
  },
  {
    op: "auth.doctor",
    path: ["doctor"],
    aliases: [["auth", "doctor"]],
    description: "Diagnose config, secrets, network and open rotations",
    positionals: [],
    flags: [
      { field: "offline", flags: "--offline", description: "skip network and role checks", type: "boolean" },
    ],
  },
];

export const SPECS: readonly CommandSpec[] = [...PROFILE_SPECS, ...AUTH_SPECS];

export function specFor(op: string): CommandSpec | undefined {
  return SPECS.find((s) => s.op === op);
}

/** The long flag name, e.g. "--limit <usd>" → "--limit", "-w, --workspace <ref>" → "--workspace". */
export function longFlag(flags: string): string {
  const m = flags.match(/--[a-z0-9-]+/);
  if (!m) throw new Error(`flag spec without long name: ${flags}`);
  return m[0];
}

/** commander's attribute name for a flag: "--mgmt-key-ref" → "mgmtKeyRef", "--no-verify" → "verify". */
export function attributeName(flags: string): string {
  const name = longFlag(flags).slice(2).replace(/^no-/, "");
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
