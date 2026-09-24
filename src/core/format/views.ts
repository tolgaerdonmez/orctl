import type { View } from "./view.ts";
import { keyViews } from "./views-keys.ts";
import { modelViews } from "./views-models.ts";
import { profileViews } from "./views-profile.ts";

/** Presentation for every operation, keyed by op id. */
export const VIEWS: Record<string, View> = {
  ...profileViews,
  ...modelViews,
  ...keyViews,
};

export function viewFor(opId: string): View | undefined {
  return VIEWS[opId];
}
