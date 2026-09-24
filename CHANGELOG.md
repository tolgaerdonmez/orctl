# Changelog

## 1.0.0 (unreleased; tag after merge)

The first complete version: every phase of the v1 plan (F0–F9).

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
- F5: `keys create` with exactly-once delivery (`--store [keychain:…]`, `--show`, `--copy`; asked
  on a terminal, required otherwise), second-precision `--expires` (ISO, date or 30d), automatic
  rollback when delivery fails, orphan detection when the outcome is unknown (exit 12);
  `keys update` (rename, `--limit none`, reset, BYOK), `keys disable|enable`, `keys rm` with typed
  confirmation; TUI key form, one-time SecretReveal dialog (copy / store / warn before closing),
  space to enable/disable, D to delete.
- F6: `keys rotate`: pure planner (same name, limit, reset, BYOK, workspace; expiry from
  `--expires` or the old key's lifetime), then create → deliver (the profile's own user key is
  updated in place in its Keychain item) → verify with GET /key → rename and disable the old key
  (`--keep-old-enabled`, `--delete-old`), with a secret-free journal, automatic rollback of an
  undelivered key, step-boundary SIGINT handling and `doctor` recovery steps; TUI RotateWizard
  (plan, delivery, confirmation, live progress, one-time reveal).
- F7: `orctl usage` over the last 30 completed UTC days (GET /activity, one call, breakdown
  computed locally) by model (default), provider, day or workspace, with `--days`,
  `--since/--until` (30-day limit enforced), `--key`, `--workspace`, totals, share, spend bars and
  CSV; `--by key` uses the per-key counters and says so. TUI Usage screen (breakdown tabs, date
  window) and a "top models, last 7 days" dashboard card.
- F8: `workspaces list|show|create|update|rm|members` and `workspaces budget list|set|rm`
  (daily/weekly/monthly/lifetime, BYOK toggle); typed-slug deletion, the default workspace is never
  deleted, membership stays read-only; TUI Workspaces list and detail (Budgets / Members / Keys
  tabs, budget and workspace forms).
- F9: `orctl completion zsh` generated from the command spec; `keychain:` references use the
  Secret Service through Bun.secrets on Linux (macOS keeps /usr/bin/security); CI smoke-tests the
  compiled binary offline; README, smoke checklist and Nix install notes completed.

