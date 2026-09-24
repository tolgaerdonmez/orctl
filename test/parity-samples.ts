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
  "models.list": [
    {},
    {
      q: "claude sonnet",
      sort: "price",
      maxPrice: 1.5,
      minContext: 200000,
      param: "tools,reasoning",
      free: true,
    },
    {
      zdr: true,
      region: "eu",
      provider: "openai",
      sort: "popular",
      limit: 20,
      modality: "image",
      author: "google",
    },
    { minPrice: 0.1, maxOutputPrice: 2 },
  ],
  "models.show": [{ id: "openai/gpt-6-luna-pro" }, { id: "nex-agi/nex-n2.5-mini:free" }],
  "models.endpoints": [{ id: "openai/gpt-6-luna-pro" }, { id: "openai/gpt-6-luna", sort: "uptime" }],
  "providers.list": [{}, { q: "open ai" }],
  "providers.show": [{ slug: "cerebras" }],
};
