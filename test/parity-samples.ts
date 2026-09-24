import { Secret } from "../src/core/secret.ts";
import { FAKE_MGMT_KEY, FAKE_USER_KEY } from "./fakes/keys.ts";

/** Representative inputs per operation for the formatCli ↔ parse round-trip (test/parity.test.ts). */
export const PARITY_SAMPLES: Record<string, Array<Record<string, unknown>>> = {
  "profile.list": [{}, { verify: true }],
  "profile.show": [{}, { name: "acme" }],
  "profile.add": [
    { name: "personal", mgmtKeySecret: new Secret(FAKE_MGMT_KEY), color: "green", default: true },
    {
      name: "acme",
      mgmtKeyRef: "op://Work/OpenRouter ACME/management key",
      label: "ACME org",
      verify: false,
    },
    { name: "ci", userKeySecret: new Secret(FAKE_USER_KEY), workspace: "research" },
  ],
  "profile.set": [
    {
      name: "acme",
      label: "It's ACME",
      color: "red",
      mgmtKey: false,
      userKeyRef: "env:ACME_USER",
      verify: false,
    },
    { name: "personal", mgmtKeySecret: new Secret(FAKE_MGMT_KEY), default: true },
  ],
  "profile.use": [{ name: "acme" }],
  "profile.rename": [{ name: "old", newName: "new-name" }],
  "profile.remove": [{ name: "acme" }, { name: "acme", purgeSecrets: true }],
  "auth.whoami": [{}],
  "auth.doctor": [{}, { offline: true }],
};
