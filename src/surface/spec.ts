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

export const MODEL_SORT_CHOICES = [
  "price",
  "price-desc",
  "output-price",
  "context",
  "newest",
  "name",
  "popular",
  "top-weekly",
  "throughput",
  "latency",
  "intelligence",
  "coding",
  "agentic",
] as const;

export const MODEL_SPECS: CommandSpec[] = [
  {
    op: "models.list",
    path: ["models", "list"],
    aliases: [["models", "ls"]],
    description: "Search models with prices in $ per million tokens (no key needed)",
    positionals: [],
    flags: [
      { field: "q", flags: "--q <text>", description: "search id and name", type: "string" },
      {
        field: "sort",
        flags: "--sort <key>",
        description: "sort order",
        type: "string",
        choices: MODEL_SORT_CHOICES,
      },
      { field: "maxPrice", flags: "--max-price <usd>", description: "max input $/M", type: "number" },
      { field: "minPrice", flags: "--min-price <usd>", description: "min input $/M", type: "number" },
      {
        field: "maxOutputPrice",
        flags: "--max-output-price <usd>",
        description: "max output $/M",
        type: "number",
      },
      {
        field: "minContext",
        flags: "--min-context <tokens>",
        description: "minimum context length",
        type: "number",
      },
      {
        field: "modality",
        flags: "--modality <m>",
        description: "text, image, audio, file… (input or output)",
        type: "string",
      },
      {
        field: "author",
        flags: "--author <author>",
        description: "model author, e.g. anthropic",
        type: "string",
      },
      { field: "free", flags: "--free", description: "only free models", type: "boolean" },
      {
        field: "param",
        flags: "--param <names>",
        description: "required parameters, e.g. tools,reasoning",
        type: "string",
      },
      {
        field: "zdr",
        flags: "--zdr",
        description: "zero-data-retention endpoints only (server-side)",
        type: "boolean",
      },
      {
        field: "region",
        flags: "--region <region>",
        description: "eu or us (server-side)",
        type: "string",
        choices: ["eu", "us"],
      },
      {
        field: "provider",
        flags: "--provider <slug>",
        description: "served by this provider (server-side)",
        type: "string",
      },
      { field: "limit", flags: "--limit <n>", description: "show at most n rows", type: "number" },
    ],
    list: true,
    cached: true,
    examples: [
      "orctl models list --q claude --sort price",
      "orctl models list --max-price 1 --param tools --min-context 200000",
      "orctl models list --free --json",
    ],
  },
  {
    op: "models.show",
    path: ["models", "show"],
    description: "Show a model: pricing tiers, context, reasoning, parameters",
    positionals: [
      { field: "id", name: "author/slug", required: true, description: "model id, e.g. openai/gpt-6-luna" },
    ],
    flags: [],
    cached: true,
  },
  {
    op: "models.endpoints",
    path: ["models", "endpoints"],
    description: "Per-provider prices, uptime, latency and throughput",
    positionals: [{ field: "id", name: "author/slug", required: true, description: "model id" }],
    flags: [
      {
        field: "sort",
        flags: "--sort <key>",
        description: "price | uptime | latency | throughput",
        type: "string",
        choices: ["price", "uptime", "latency", "throughput"],
      },
    ],
    list: true,
    cached: true,
  },
  {
    op: "providers.list",
    path: ["providers", "list"],
    aliases: [["providers", "ls"]],
    description: "List inference providers",
    positionals: [],
    flags: [{ field: "q", flags: "--q <text>", description: "search name and slug", type: "string" }],
    list: true,
    cached: true,
  },
  {
    op: "providers.show",
    path: ["providers", "show"],
    description: "Show a provider's headquarters, datacenters and policies",
    positionals: [{ field: "slug", name: "slug", required: true, description: "provider slug" }],
    flags: [],
    cached: true,
  },
];

export const SPECS: readonly CommandSpec[] = [...PROFILE_SPECS, ...AUTH_SPECS, ...MODEL_SPECS];

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
