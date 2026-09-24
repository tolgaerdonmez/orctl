# Changelog

## Unreleased

- F0: project skeleton, error taxonomy and exit codes, secret redaction, SDK client factory that
  closes the three SDK traps (debug logger, implicit `OPENROUTER_API_KEY`, mutation retries),
  CLI output layer (table / `--json` envelope / CSV), architecture and leak tests.
- F1: profiles as a first-class concept: `profile add|set|use|rename|rm|list|show`, secret
  references (`keychain:`, `op://`, `env:`, `file:`), macOS Keychain writes over `security -i`
  stdin, `whoami`, `doctor`.
