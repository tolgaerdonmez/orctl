# Changelog

## Unreleased

- F0: project skeleton, error taxonomy and exit codes, secret redaction, SDK client factory that
  closes the three SDK traps (debug logger, implicit `OPENROUTER_API_KEY`, mutation retries),
  CLI output layer (table / `--json` envelope / CSV), architecture and leak tests.
- F1: profiles as a first-class concept: `profile add|set|use|rename|rm|list|show`, secret
  references (`keychain:`, `op://`, `env:`, `file:`), macOS Keychain writes over `security -i`
  stdin, `whoami`, `doctor`.
- F2: full-screen TUI (OpenTUI + React) sharing the same operations: header badge in the profile
  color, tabs 1–7, footer with the equivalent CLI command (`y` copies it), command palette
  (`ctrl+p`), profile switcher (`ctrl+o`), help with diagnostics, Profiles screen with an add/edit
  wizard (masked key entry, server verification), typed-name confirmation for removal. `orctl`
  alone opens the TUI on a terminal; `orctl tui <screen>` deep-links. Nix flake builds the
  compiled binary (`nix build`, `nix run`).
- F3: public model and provider catalog without any key: `models list` (instant local filters on
  a 10-minute cached full list; zdr/region/provider and popularity/benchmark sorts go to the
  API), `models show` (pricing tiers, reasoning, context), `models endpoints` (per-provider price,
  uptime, latency, throughput), `providers list|show`; exact bigint $/M pricing with free,
  variable and tiered flags; `--refresh` / `--offline`; TUI Models (search, filters, sort,
  fetched-at), ModelDetail (Overview / Pricing / Endpoints) and Providers screens.
- F4: `keys list` walks every workspace (offset pagination, dedupe, partial-failure warnings,
  `--strict` → exit 11, default-workspace fallback), key references (hash, hash prefix, name,
  `…label`, ambiguity lists candidates), `keys show`, `credits`; TUI Keys screen (workspace
  cycling, disabled toggle, detail panel), key detail and a Dashboard with credits, keys expiring
  within 14 days and keys above 80% of their limit.
