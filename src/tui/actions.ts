/**
 * Every TUI action and the operation it runs (plan §5.2, §7.2). The parity test checks that each
 * entry names a registered operation and that every operation is reachable from the TUI.
 */
export interface TuiAction {
  op: string;
  /** Screen that hosts the action (a tab id or a detail screen id). */
  screen: string;
  /** Key on that screen, when the action has one. */
  key?: string | undefined;
  label: string;
}

export const TUI_ACTIONS: TuiAction[] = [
  { op: "profile.list", screen: "profiles", label: "List profiles" },
  { op: "profile.list", screen: "profiles", key: "v", label: "Verify all profiles" },
  { op: "profile.show", screen: "profiles", label: "Profile details (right panel)" },
  { op: "profile.add", screen: "profiles", key: "a", label: "Add a profile" },
  { op: "profile.set", screen: "profiles", key: "e", label: "Edit a profile" },
  { op: "profile.use", screen: "profiles", key: "enter", label: "Use profile (ctrl+o anywhere)" },
  { op: "profile.rename", screen: "profiles", key: "R", label: "Rename a profile" },
  { op: "profile.remove", screen: "profiles", key: "D", label: "Remove a profile" },
  { op: "auth.whoami", screen: "dashboard", key: "w", label: "Who am I (refresh)" },
  { op: "auth.doctor", screen: "help", key: "d", label: "Diagnostics (doctor)" },
];
