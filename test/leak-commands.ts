import type { Harness } from "./helpers.ts";

/** Every CLI command the leak test exercises; later phases append their commands here. */
export const LEAK_COMMANDS: string[][] = [
  ["profile", "list"],
  ["profile", "list", "--verify"],
  ["profile", "show"],
  ["whoami"],
  ["doctor"],
];

/** Extra fake routes needed by LEAK_COMMANDS beyond the profile basics. */
export function registerLeakFixtures(_h: Harness): void {}
