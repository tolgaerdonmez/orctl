import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { zshCompletion } from "../../src/cli/completion.ts";
import { OrctlError } from "../../src/core/errors.ts";
import { Secret } from "../../src/core/secret.ts";
import { createBunSecretsBackend, type SecretsApi } from "../../src/core/secrets/bun-secrets.ts";
import { parseSecretRef } from "../../src/core/secrets/ref.ts";
import { SPECS } from "../../src/surface/spec.ts";
import { FAKE_MGMT_KEY } from "../fakes/keys.ts";
import { harness } from "../helpers.ts";

const zsh = Bun.which("zsh");

describe("zsh completion (plan §12 F9)", () => {
  test("covers every command path and flag from the spec", () => {
    const script = zshCompletion();
    for (const spec of SPECS) {
      expect(script).toContain(`'${spec.path.slice(0, -1).join(" ")}|${spec.path[spec.path.length - 1]}'`);
    }
    expect(script).toContain(
      "'keys create' '--limit --reset --expires --workspace --include-byok-in-limit --store --show --copy'",
    );
  });

  test("orctl completion zsh prints it; other shells exit 2", async () => {
    const h = harness();
    try {
      const r = await h.cli(["completion", "zsh"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toStartWith("#compdef orctl");
      expect((await h.cli(["completion", "fish"])).code).toBe(2);
    } finally {
      h.cleanup();
    }
  });

  test.skipIf(!zsh)("is valid zsh and completes subcommands and flags", async () => {
    const dir = resolve(import.meta.dir, "..", "..", ".tmp", `zsh-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "_orctl");
    writeFileSync(file, zshCompletion());
    const driver = join(dir, "drive.zsh");
    writeFileSync(
      driver,
      `_describe() { shift 3; print -l -- "\${(@P)1}"; }
compadd() { [[ $1 == -a ]] && print -l -- "\${(@P)2}"; }
_orctl_under_test=1
source ${file} >/dev/null
words=(orctl workspaces budget ""); CURRENT=4; PREFIX=""; _orctl
print -- ---
words=(orctl keys rotate ci-bot --del); CURRENT=5; PREFIX="--del"; _orctl
`,
    );
    const proc = Bun.spawn([zsh as string, "-f", driver], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    const [subs, flags] = out.split("---\n");
    expect(subs).toContain("set:Set a workspace budget");
    expect(flags).toContain("--delete-old");
    expect(flags).toContain("--profile");
  });
});

describe("Linux Secret Service backend (Bun.secrets)", () => {
  test("reads, writes and deletes through the API; refuses non-key values", async () => {
    const store = new Map<string, string>();
    const api: SecretsApi = {
      get: async ({ service, name }) => store.get(`${service}/${name}`) ?? null,
      set: async ({ service, name, value }) => void store.set(`${service}/${name}`, value),
      delete: async ({ service, name }) => store.delete(`${service}/${name}`),
    };
    const b = createBunSecretsBackend(api);
    const ref = parseSecretRef("keychain:orctl/acme/management");
    await b.write?.(ref, new Secret(FAKE_MGMT_KEY), "label");
    expect(store.get("orctl/acme/management")).toBe(FAKE_MGMT_KEY);
    expect((await b.read(ref)).reveal()).toBe(FAKE_MGMT_KEY);
    await expect(b.write?.(ref, new Secret("not a key"), "l")).rejects.toBeInstanceOf(OrctlError);
    expect(await b.delete?.(ref)).toBe(true);
    await expect(b.read(ref)).rejects.toMatchObject({ code: "NO_CREDENTIAL" });
  });

  test("an unavailable Secret Service becomes NO_CREDENTIAL with a hint", async () => {
    const api: SecretsApi = {
      get: async () => {
        throw new Error("no secret service");
      },
      set: async () => {},
      delete: async () => false,
    };
    await expect(
      createBunSecretsBackend(api).read(parseSecretRef("keychain:orctl/x/y")),
    ).rejects.toMatchObject({
      code: "NO_CREDENTIAL",
    });
  });
});
