# orctl

`orctl` manages OpenRouter accounts from the terminal: profiles for several accounts, API keys,
credits, usage, workspaces and budgets, plus a fast model and price browser. It is one tool with
two faces: a classic CLI for scripts and a full-screen TUI for browsing. Both run the same
operations, and the TUI always shows the equivalent CLI command.

Inference (chat), buying credits and creating management keys are out of scope: OpenRouter only
allows those on its website.

> Status: under active development (v1 phases F0–F9). See [CHANGELOG.md](CHANGELOG.md).

## Install

orctl targets [Bun](https://bun.com) ≥ 1.4 and ships as a single compiled binary.

```sh
# development
bun install
bun run dev -- --help          # = bun run src/main.ts --help

# single binary
bun run build                  # → dist/orctl
```

A Nix flake is included (`nix develop` gives a shell with Bun).

## Profiles

A **profile** is the access context for one OpenRouter account (personal or an organization). It
holds a *management key* (for keys, credits, usage and workspaces), an optional *user key* (for
`whoami` limits and free-tier quota), a color, a label and a default workspace.

Management keys are created only at <https://openrouter.ai/settings/management-keys>; giving them
an expiry is recommended.

```sh
orctl profile add personal                  # guided: key source, verification, workspace, color
op read "op://Private/OpenRouter/management key" | orctl profile add ci --mgmt-key-stdin --color yellow
orctl profile add acme --mgmt-key-ref "op://Work/OpenRouter ACME/management key" --color red
orctl profile list [--verify]
orctl profile use acme
orctl whoami
orctl doctor
```

The config file (`~/.config/orctl/config.toml`, 0600) holds **references only**, never key values:

```toml
version = 1
default_profile = "personal"

[profiles.personal]
label = "Personal"
color = "green"
management_key = "keychain:orctl/personal/management"
user_key       = "keychain:orctl/personal/user"      # optional
workspace      = "default"                           # optional

[profiles.acme]
color = "red"
management_key = "op://Work/OpenRouter ACME/management key"
```

| Reference | Read | Written by orctl |
|---|---|---|
| `keychain:<service>/<account>` | macOS Keychain via `/usr/bin/security` | yes (default target) |
| `op://<vault>/<item>/<field>` | 1Password CLI (`op read`) | no |
| `env:<VAR>` | environment variable | no |
| `file:<path>` | file, must be `0600` | no |

The active profile lives in `~/.local/state/orctl/state.json`, so `orctl profile use` works even
when `config.toml` is managed read-only by Nix/home-manager; in that case config-changing commands
print the TOML to add instead of writing.

Profile selection order: `--profile/-p` → `ORCTL_PROFILE` → an ephemeral `env` profile when
`ORCTL_MANAGEMENT_KEY` / `ORCTL_USER_KEY` are set → `orctl profile use` → `default_profile` → the
only profile. `OPENROUTER_API_KEY` is deliberately ignored; bind it explicitly with
`--user-key-ref env:OPENROUTER_API_KEY` if you want it.

## Output

Every command prints an aligned table or summary by default and accepts:

- `--json`: a stable, versioned envelope `{"ok", "data", "error", "meta"}` (additive changes only);
- `--csv` and `--columns a,b,+optional` on list commands;
- `--no-color` / `NO_COLOR`, `-q/--quiet`, `--timeout <s>`, `--debug` (redacted SDK logs on stderr).

Commands that change something print a one-line banner on stderr naming the profile and workspace.
Destructive commands ask you to type the name on a terminal and require `--yes` otherwise.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | OK |
| 2 | usage error, ambiguous reference, missing confirmation |
| 3 | no credential (no profile, missing or unresolvable key reference) |
| 4 | authentication/authorization (401/403) |
| 5 | not found |
| 6 | payment required (402) |
| 7 | rate limited (429; `Retry-After` in the message) |
| 8 | OpenRouter server error (5xx) |
| 9 | unexpected response shape |
| 10 | network error or timeout |
| 11 | partial result with `--strict` |
| 12 | a change failed on the network and its outcome is unknown |
| 130 | interrupted |

## Security principles

- A key value never appears in argv, config, logs, caches or JSON output. It goes to exactly one of:
  the Keychain (written through `security -i` on stdin), stdout (only with `--show`), or the
  clipboard (only with `--copy`, cleared after 45 s when unchanged).
- The OpenRouter SDK is always given an explicit key (`""` for public calls), an explicit server
  URL and orctl's own redacting debug logger, so `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` and
  `OPENROUTER_DEBUG` can never change identity, destination or logging behind your back.
- Mutations are sent once (no automatic retries), so a flaky network cannot create duplicate keys.
- Only public model/provider data is cached on disk; account data stays in memory.

## Development

```sh
bun install
bun test              # unit, service (fake HTTP), CLI, architecture, parity and leak tests
bun run typecheck     # tsc --noEmit
bun run lint          # biome check
```

Layout: `src/core` (domain: profiles, secrets, SDK client, operations), `src/surface` (the CLI
surface as data), `src/cli` (commander adapter), `src/tui` (OpenTUI adapter). `test/arch.test.ts`
enforces the import direction. See [docs/smoke.md](docs/smoke.md) for the manual live checks.

## License

MIT
