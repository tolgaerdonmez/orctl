# orctl

`orctl` manages OpenRouter accounts from the terminal: profiles for several accounts, API keys,
credits, usage, workspaces and budgets, plus a fast model and price browser. It is one tool with
two faces: a classic CLI for scripts and a full-screen TUI for browsing. Both run the same
operations, and the TUI always shows the equivalent CLI command.

Inference (chat), buying credits and creating management keys are out of scope: OpenRouter only
allows those on its website.

> Status: 1.0.0, see [CHANGELOG.md](CHANGELOG.md). Live checks against real keys are listed in
> [docs/smoke.md](docs/smoke.md).

## Quick start

1. Create a management key at <https://openrouter.ai/settings/management-keys> (give it an expiry).
2. `orctl profile add personal` and paste it; orctl verifies it and stores it in the Keychain.
3. `orctl whoami`, `orctl keys list`, `orctl models list --q claude --sort price`, or just `orctl`
   for the TUI.

## Commands

| Area | Commands |
|---|---|
| Profiles | `profile add · set · use · rename · rm · list · show`, `whoami`, `doctor` |
| Keys | `keys list · show · create · update · disable · enable · rm · rotate`, `credits` |
| Usage | `usage [--by model\|provider\|day\|workspace\|key]` |
| Workspaces | `workspaces list · show · create · update · rm · members`, `workspaces budget list · set · rm` |
| Catalog (no key) | `models list · show · endpoints`, `providers list · show` |
| Other | `tui [screen]`, `completion zsh` |

Every command has `--help` with its flags and examples. Shell completion for zsh:
`orctl completion zsh > "${fpath[1]}/_orctl"`.

## Install

orctl targets [Bun](https://bun.com) ≥ 1.4 and ships as a single compiled binary.

```sh
# development
bun install
bun run dev -- --help          # = bun run src/main.ts --help

# single binary
bun run build                  # → dist/orctl
```

### Nix

The repository is a flake:

```sh
nix run github:tolgaerdonmez/orctl -- models list --max-price 1   # one-off
nix build github:tolgaerdonmez/orctl                               # → result/bin/orctl
nix develop                                                        # shell with Bun
```

For a permanent install on a Nix-managed machine, add it to your system flake instead of
`npm i -g` / `bun install -g`:

```nix
# flake inputs
orctl.url = "github:tolgaerdonmez/orctl";
# home-manager
home.packages = [ inputs.orctl.packages.${pkgs.system}.default ];
```

The flake compiles the single binary from a fixed-output `node_modules` derivation (bun2nix does
not read Bun 1.4 lockfiles yet). After changing dependencies, set the `outputHash` in `flake.nix`
to `lib.fakeHash`, run `nix build`, and paste the hash it reports.

An optional declarative config works too; orctl then prints the TOML to add instead of writing:

```nix
xdg.configFile."orctl/config.toml".source = (pkgs.formats.toml { }).generate "orctl.toml" {
  version = 1;
  default_profile = "personal";
  profiles.personal = {
    label = "Personal";
    color = "green";
    management_key = "keychain:orctl/personal/management";
  };
};
```

## TUI

`orctl` with no arguments on a terminal opens the full-screen UI (`orctl tui <screen>` deep-links
to `keys`, `models`, `providers`, `usage`, `workspaces` or `profiles`). Every action runs the same
operation as its CLI command, and the footer always shows that command; `y` copies it.

| Key | Action |
|---|---|
| `1`–`7` | Dashboard · Keys · Models · Providers · Usage · Workspaces · Profiles |
| `ctrl+o` | switch profile |
| `ctrl+p` | command palette (every operation and its CLI form) |
| `?` | help and diagnostics |
| `r` | refresh (on Keys: rotate) |
| `/` | filter the current list |
| `y` | copy the CLI equivalent |
| `esc` / `q` | back / quit |

Screen keys: Keys `n` new · `e` edit · `space` enable/disable · `r` rotate · `D` delete · `tab`
workspace · `x` disabled; Models `/` search · `f` filters · `s` sort; Usage `tab` breakdown ·
`[ ]` window; Workspaces `enter` details, then `tab` Budgets/Members/Keys, `n`/`e`/`D`; Profiles
`a` add · `e` edit · `enter` use · `R` rename · `D` remove · `v` verify. A new key is shown once in a
dialog (`c` copy, `s` store in the Keychain); the TUI runs on the alternate screen, so it never
reaches the terminal scrollback.

The header shows the active profile in its color (`● personal · Personal · ws default · [M][U]`),
so a red organization profile is hard to miss before a destructive action.

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
| `keychain:<service>/<account>` | macOS Keychain via `/usr/bin/security`; Secret Service (libsecret) via Bun on Linux | yes (default target) |
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

## Keys and credits

```sh
orctl keys list                         # every workspace (GET /keys alone only shows the default one)
orctl keys list --workspace research --include-disabled --sort usage
orctl keys show ci-bot                  # hash, hash prefix (≥6 hex), exact name, or …1c96 label suffix
orctl credits                           # purchased, used, left
```

Creating and changing keys:

```sh
orctl keys create ci-bot --limit 50 --reset monthly --expires 90d --store    # → Keychain
orctl keys create scratch --limit 1 --expires 1d --show --json | jq -r .data.key
orctl keys create laptop --copy                                            # clipboard, cleared after 45 s
orctl keys update ci-bot --limit none --rename ci
orctl keys disable ci-bot && orctl keys enable ci-bot
orctl keys rm ci-bot                                                       # type the name to confirm
```

A new key's plaintext is returned by OpenRouter exactly once, so `keys create` needs to know where
it goes (`--store`, `--show` or `--copy`; asked on a terminal). If storing fails, the new key is
deleted again. If the request fails on the network, orctl checks whether the key was created
anyway and tells you how to delete that orphan (exit 12).

Rotating a key keeps its name, limit, reset, BYOK setting and workspace:

```sh
orctl keys rotate ci-bot --store --yes           # create → store → verify → disable + rename old
orctl keys rotate ci-bot --copy --delete-old     # asks for the name before deleting the old key
orctl keys rotate ci-bot --expires 90d --keep-old-enabled --show
```

The new key expires after the same lifetime as the old one unless `--expires` says otherwise. It
is verified with `GET /key` (no spend) before the old key is disabled; the old key is renamed to
`<name> (rotated YYYY-MM-DD)` and only deleted with `--delete-old`. When the key being rotated is
the profile's own user key, its Keychain item is updated in place. Each rotation keeps a journal
under `~/.local/state/orctl/rotations/` (no secrets); if a step fails or you press Ctrl+C, the
command stops at a step boundary and `orctl doctor` explains how to finish.

Ambiguous references (two keys named `ci-bot` in different workspaces) exit with code 2 and list
the candidates; add `--workspace` or use a hash prefix. If one workspace fails, the list is still
printed with a warning; `--strict` turns that into exit code 11.

## Usage

```sh
orctl usage                              # by model, last 30 days
orctl usage --by provider --days 7
orctl usage --by day --since 2026-09-01 --csv
orctl usage --key ci-bot                 # one key's activity
orctl usage --by key                     # per-key counters: today / week / month / all time
```

OpenRouter's activity API covers the last 30 completed UTC days and its rows carry no key, so
`--by key` reads the per-key usage counters instead (the output says which source it used).

## Workspaces and budgets

```sh
orctl workspaces list
orctl workspaces show research                  # budgets, members, key count
orctl workspaces create "Data Science"          # slug derived: data-science
orctl workspaces budget set research monthly 100 --include-byok
orctl workspaces budget rm research monthly
orctl workspaces members research               # read-only in v1
orctl workspaces rm data-science                # type the slug to confirm
```

## Models and prices

No key is needed for the public catalog. Prices are shown in USD per million tokens, computed
exactly from OpenRouter's per-token strings.

```sh
orctl models list --q claude --sort price
orctl models list --max-price 1 --param tools --min-context 200000
orctl models list --free
orctl models list --zdr --region eu            # server-side filters
orctl models show openai/gpt-6-luna-pro        # tiers (⚑), cache, per-request/search fees
orctl models endpoints openai/gpt-6-luna-pro --sort uptime
orctl providers list
```

`FREE` marks free models, `VAR` router models whose price depends on the routed model (sorted
last and excluded by price filters), and `⚑` tiered pricing (for example a higher rate above
272K prompt tokens; details in `models show`). The full model list is cached for 10 minutes,
providers for 24 hours and endpoints for 5 minutes under `~/.cache/orctl/v1/`; `--refresh`
refetches and `--offline` uses only the cache. Only public data is ever cached on disk.

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
