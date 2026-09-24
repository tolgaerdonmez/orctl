# Manual live smoke tests

The automated suite runs against a fake HTTP layer and fake secret stores. These checks need real
OpenRouter keys and the real macOS Keychain, so they are run by hand. Use throwaway profiles.

Point orctl at a scratch home so nothing touches your real config:

```sh
export ORCTL_CONFIG=$PWD/.tmp/smoke/config.toml
export XDG_STATE_HOME=$PWD/.tmp/smoke/state XDG_CACHE_HOME=$PWD/.tmp/smoke/cache
```

## F1: profiles

1. Keychain profile: `orctl profile add smoke-kc` → "Paste (stored in Keychain)" → paste a
   management key. Expect "Verified: management role" and
   `keychain:orctl/smoke-kc/management` in the config.
2. 1Password profile: `orctl profile add smoke-op --mgmt-key-ref "op://<vault>/<item>/<field>"`.
3. `orctl whoami -p smoke-kc` and `orctl whoami -p smoke-op` both show credits.
4. `orctl profile use smoke-op && orctl whoami` shows `selected via state`.
5. While step 1 runs, `ps -ax -o args | grep security` must never show an `sk-or-` value.
6. Build twice (`bun run build`, change nothing, rebuild) and run `./dist/orctl whoami -p smoke-kc`
   after each build: no new Keychain access prompt should appear (the item was created by
   `/usr/bin/security`, not by the orctl binary).
7. Clean up: `orctl profile rm smoke-kc --purge-secrets --yes`, `orctl profile rm smoke-op --yes`.

Optional automated Keychain check (writes and deletes a random `orctl-test-*` item):
`ORCTL_IT_KEYCHAIN=1 bun test test/core/keychain-it.test.ts`.

## F5: key mutations

Use a throwaway profile with a management key.

1. `orctl keys create smoke-f5 --limit 0.01 --expires 1d --store` → note the stored reference.
2. `orctl keys show smoke-f5` shows the $0.01 limit and tomorrow's expiry.
3. `orctl keys update smoke-f5 --rename smoke-f5b` then `orctl keys disable smoke-f5b`.
4. `orctl keys rm smoke-f5b` (type the name) and delete the Keychain item:
   `security delete-generic-password -s orctl -a <account from step 1>`.

## F6: rotation

1. `orctl keys create smoke-f6 --limit 0.01 --expires 1d --store`
2. `orctl keys rotate smoke-f6 --store --yes` → the output says "verified with GET /key: yes" and
   the old key is `smoke-f6 (rotated <date>)`, disabled.
3. `orctl keys list --include-disabled` shows both; `orctl doctor` reports no unfinished rotations.
4. Clean up: `orctl keys rm smoke-f6 --yes`, `orctl keys rm "smoke-f6 (rotated <date>)" --yes`, and
   the two Keychain items under service `orctl`.

## Public catalog and TUI (no key needed)

1. `orctl models list --q claude --sort price` lists priced models; `--offline` works right after.
2. `orctl models show openai/gpt-6-luna-pro` shows a `⚑ ≥272K prompt tokens` tier.
3. `orctl` opens the TUI; `3` Models, `/` search, `enter` a model, `tab` through Pricing and
   Endpoints; `ctrl+p` palette; `q` quits and the terminal is restored with nothing left behind.

## F7–F8: usage and workspaces (read-mostly)

1. `orctl usage --days 7`, `orctl usage --by key`, `orctl credits` match the website's numbers.
2. `orctl workspaces list`, `orctl workspaces show default`.
3. Optional: `orctl workspaces create "orctl smoke"`, `orctl workspaces budget set orctl-smoke daily 1`,
   then `orctl workspaces rm orctl-smoke`.

## Install through nix-config

1. In `~/nix-config`: add the flake input `orctl.url = "github:tolgaerdonmez/orctl";` and
   `inputs.orctl.packages.${pkgs.system}.default` to `home.packages`.
2. `nix build` the configuration, commit, `nrs`; then `orctl --version` prints 1.0.0.

