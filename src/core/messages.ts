import { MANAGEMENT_KEYS_URL } from "./version.ts";

/**
 * User-facing text lives here (plan K15): English today, and one place to translate later.
 * Only text that is reused or that carries guidance belongs here; one-off column headers stay
 * next to their column definitions.
 */
export const messages = {
  configHeader:
    "# orctl configuration: holds secret references only, never key values.\n# Written by orctl; comments are not preserved.",
  configHoldsRawKey: (file: string, paths: string[]) =>
    `${file} contains what looks like a raw API key (${paths.join(", ")}); orctl refuses to load it.`,
  configRawKeyHint:
    "Move the key into the Keychain (`orctl profile set <name> --mgmt-key-stdin`) and keep only a reference such as keychain:orctl/<name>/management in the config.",
  loosePermissions: (file: string, mode: string) =>
    `${file} has permissions ${mode}; run \`chmod 600 ${file}\` (orctl doctor explains).`,
  unknownField: (path: string) => `config: unknown field "${path}" is kept but ignored.`,
  configReadOnly: (file: string, reason: string) =>
    reason === "nix"
      ? `config is managed by Nix (${file} is a read-only store link).`
      : `${file} is a symlink; orctl will not write through it.`,
  configReadOnlyHint: (snippet: string, profile?: string) =>
    [
      profile
        ? `Add this to your declarative config for profile "${profile}":`
        : "Declarative config should contain:",
      "",
      snippet.trimEnd(),
      "",
      "With home-manager, e.g.:",
      '  xdg.configFile."orctl/config.toml".source = (pkgs.formats.toml {}).generate "orctl.toml" { ... };',
      "`orctl profile use` still works: the active profile lives in state.json.",
    ].join("\n"),
  unknownProfile: (name: string) => `Profile "${name}" does not exist.`,
  availableProfiles: (names: string[]) => `Available profiles: ${names.join(", ")}.`,
  addProfileHint: "Create one with `orctl profile add <name>`.",
  noProfile: "No profile is configured, and this command needs an OpenRouter key.",
  missingRole: (profile: string, role: "management" | "user") =>
    `Profile "${profile}" has no ${role} key reference.`,
  missingRoleHint: (profile: string, role: "management" | "user") =>
    role === "management"
      ? `orctl profile set ${profile} --mgmt-key-stdin   (or --mgmt-key-ref keychain:… / op://…)`
      : `orctl profile set ${profile} --user-key-stdin   (or --user-key-ref …)`,
  managementKeyOrigin: `Management keys are created only at ${MANAGEMENT_KEYS_URL}; giving them an expiry is recommended.`,
  wrongRoleForCommand: (profile: string) =>
    `This command needs a management key, and profile "${profile}"'s management key was rejected.`,
  connectKeyHint:
    "Keys provisioned by a Connect/OAuth client cannot be changed or deleted with a management key.",
  rateLimitHint: (retryAfter?: string) =>
    `${retryAfter ? `Retry after ${retryAfter}s. ` : ""}Rate limits are account-wide; creating more keys does not raise them.`,
  paymentHint: "Credits are topped up on the OpenRouter website.",
  serverHint: "OpenRouter returned a server error; check https://status.openrouter.ai.",
  unexpectedHint: (version: string) =>
    `The SDK schema did not match the API response. orctl ${version} pins @openrouter/sdk 1.3.21; an update may be needed.`,
  networkHint: "Check connectivity, or raise the limit with --timeout <seconds>.",
  unknownOutcome: "The request failed on the network, so it is unknown whether OpenRouter applied it.",
  interrupted: "Interrupted.",
  confirmationRequired: "This command changes or deletes data; pass --yes to confirm when not on a terminal.",
  typedConfirmMismatch: "Confirmation text did not match; nothing was changed.",
  prefixMismatch: (role: "management" | "user", prefix: string) =>
    `Key prefix "${prefix}" is unusual for a ${role} key (expected ${role === "management" ? "sk-or-mgmt-" : "sk-or-v1-"}); continuing.`,
  userKeyIsManagement:
    "This key reports is_management_key=true; add it as the management key with --mgmt-key-* instead.",
  openRouterApiKeyIgnored:
    "OPENROUTER_API_KEY is set but ignored by orctl; bind it explicitly with --user-key-ref env:OPENROUTER_API_KEY.",
  openRouterDebugSet:
    "OPENROUTER_DEBUG is set; orctl always installs its own redacting SDK logger, so it has no effect.",
} as const;
