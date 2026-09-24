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
