# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Runtime is Bun ≥ 1.4 (OpenTUI needs it). Checks: `bun test`, `bun run typecheck` (TypeScript 7 native `tsc`), `bun run lint` (Biome 2). All three must stay green.
- Layers: `src/core` → `src/surface` → `src/cli` / `src/tui`. `test/arch.test.ts` enforces the import direction; the CLI must never import the TUI (only `src/main.ts` reaches it through a dynamic import).
- Every user action is one `Operation` in `src/core/ops/registry.ts` with a CLI spec in `src/surface/spec.ts`; `test/parity.test.ts` requires a spec and round-trip samples (`test/parity-samples.ts`) for each op. Add all three together.
- Never construct `OpenRouter` directly: use `src/core/client/factory.ts` (explicit `apiKey`/`serverURL`, redacting `debugLogger`) and pass `MUTATION` on every mutating call. The SDK otherwise reads `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL` / `OPENROUTER_DEBUG` and retries `apiKeys.create` for up to an hour.
- Key values travel as `Secret` (`src/core/secret.ts`), never as argv or config values. Tests use fake keys from `test/fakes/keys.ts`; `test/leak.test.ts` scans every command's output, so add new commands to `test/leak-commands.ts`.
- Tests use the fake HTTP layer (`test/fakes/fetcher.ts`) with raw snake_case fixtures so the SDK's own zod parsing runs; temp homes live under the gitignored `.tmp/`.
- TUI tests drive `App` through `test/tui/helpers.tsx`: every input must run inside React `act()`, and a lone ESC needs the parser's timeout before the next key. TUI key handling goes through the layered `KeyRouter` in `src/tui/state.tsx` (modal > input > screen > global), not ad-hoc `useKeyboard` calls.
- Changing `bun.lock` changes the `flake.nix` `outputHash` of the node_modules derivation; refresh it (fakeHash → `nix build` → paste) in the same change.
- `SDKValidationError` has a duck-typed `Symbol.hasInstance` that matches any SDK error with a response; check HTTP status before it (see `src/core/client/map-error.ts`).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
