import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { OrctlError } from "../errors.ts";
import { atomicWrite, checkWritable, fileMode, formatMode, readTextIfExists } from "../fs-util.ts";
import { messages } from "../messages.ts";
import {
  ConfigV1,
  emptyConfig,
  emptyState,
  findRawKeys,
  KNOWN_CONFIG_FIELDS,
  KNOWN_PROFILE_FIELDS,
  migrateConfig,
  StateV1,
} from "./schema.ts";

export interface LoadedConfig {
  config: ConfigV1;
  exists: boolean;
  warnings: string[];
}

/**
 * Declarative config (config.toml, refs only) and mutable state (state.json) live in separate
 * files so `profile use` keeps working when config.toml is a read-only Nix store link (§6.2).
 */
export class ProfileStore {
  readonly configFile: string;
  readonly stateFile: string;
  #config: Promise<LoadedConfig> | undefined;

  constructor(configFile: string, stateFile: string) {
    this.configFile = configFile;
    this.stateFile = stateFile;
  }

  loadConfig(): Promise<LoadedConfig> {
    this.#config ??= this.#readConfig();
    return this.#config;
  }

  async #readConfig(): Promise<LoadedConfig> {
    const text = await readTextIfExists(this.configFile);
    if (text === null) return { config: emptyConfig(), exists: false, warnings: [] };
    let raw: Record<string, unknown>;
    try {
      raw = parseToml(text) as Record<string, unknown>;
    } catch (err) {
      throw new OrctlError("USAGE", `${this.configFile} is not valid TOML: ${(err as Error).message}`);
    }
    const leaked = findRawKeys(raw);
    if (leaked.length > 0) {
      throw new OrctlError("USAGE", messages.configHoldsRawKey(this.configFile, leaked), {
        hint: messages.configRawKeyHint,
      });
    }
    const parsed = ConfigV1.safeParse(migrateConfig(raw));
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new OrctlError("USAGE", `${this.configFile} is invalid: ${detail}`);
    }
    const warnings: string[] = [];
    const mode = await fileMode(this.configFile);
    if (mode !== null && (mode & 0o077) !== 0) {
      const writable = await checkWritable(this.configFile);
      if (writable.writable) warnings.push(messages.loosePermissions(this.configFile, formatMode(mode)));
    }
    for (const key of Object.keys(parsed.data)) {
      if (!KNOWN_CONFIG_FIELDS.has(key)) warnings.push(messages.unknownField(key));
    }
    for (const [name, profile] of Object.entries(parsed.data.profiles)) {
      for (const key of Object.keys(profile)) {
        if (!KNOWN_PROFILE_FIELDS.has(key)) warnings.push(messages.unknownField(`profiles.${name}.${key}`));
      }
    }
    return { config: parsed.data, exists: true, warnings };
  }

  async isConfigWritable() {
    return checkWritable(this.configFile);
  }

  /** Writes the config atomically with 0600, or throws a USAGE error with the TOML to add by hand. */
  async saveConfig(config: ConfigV1, changedProfile?: string): Promise<void> {
    const check = await checkWritable(this.configFile);
    if (!check.writable) {
      const snippet = changedProfile ? tomlSnippet(config, changedProfile) : stringifyToml(config);
      throw new OrctlError("USAGE", messages.configReadOnly(this.configFile, check.reason ?? "symlink"), {
        hint: messages.configReadOnlyHint(snippet, changedProfile),
        details: { toml: snippet },
      });
    }
    await atomicWrite(this.configFile, `${messages.configHeader}\n${stringifyToml(config)}\n`);
    this.#config = Promise.resolve({ config, exists: true, warnings: [] });
  }

  async loadState(): Promise<StateV1> {
    const text = await readTextIfExists(this.stateFile);
    if (text === null) return emptyState();
    try {
      const parsed = StateV1.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : emptyState();
    } catch {
      return emptyState();
    }
  }

  async saveState(state: StateV1): Promise<void> {
    await atomicWrite(this.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  }

  async updateState(mutate: (state: StateV1) => void): Promise<StateV1> {
    const state = await this.loadState();
    mutate(state);
    await this.saveState(state);
    return state;
  }
}

export function tomlSnippet(config: ConfigV1, profile: string): string {
  const body: Record<string, unknown> = { profiles: { [profile]: config.profiles[profile] ?? {} } };
  const lines = stringifyToml(body);
  return config.default_profile === profile ? `default_profile = "${profile}"\n\n${lines}` : lines;
}
