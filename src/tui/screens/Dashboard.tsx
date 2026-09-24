import { plainStyle } from "../../core/format/view.ts";
import { profileViews } from "../../core/format/views-profile.ts";
import type { WhoamiResult } from "../../core/ops/auth.ts";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";

/** Dashboard (plan §7.3): the whoami card; later phases add credits, expiring keys and top models. */
export function DashboardScreen() {
  const tui = useTui();
  const hasProfile = Boolean(tui.profile);
  const whoami = useOp<WhoamiResult>("auth.whoami", {}, { enabled: hasProfile });
  useCliHint(hasProfile ? "auth.whoami" : "profile.add", hasProfile ? {} : { name: "personal" });
  useKeys((id) => {
    if (id === "w" && hasProfile) {
      void whoami.refetch();
      return true;
    }
    if (id === "a" && !hasProfile) {
      tui.goTab("profiles");
      tui.push({ id: "profile-wizard", params: { mode: "add" } });
      return true;
    }
    return false;
  });

  if (!hasProfile) {
    return (
      <Panel title="Welcome">
        <text fg={theme.fg}>
          No profile is configured yet: only public model and provider data is available.
        </text>
        <text fg={theme.accent}>Press a to add a profile, or 3 to browse models.</text>
      </Panel>
    );
  }
  const view = profileViews["auth.whoami"];
  return (
    <box flexDirection="column" flexGrow={1}>
      <Panel title="Who am I">
        {whoami.isLoading ? <text fg={theme.muted}>Checking keys…</text> : null}
        {whoami.error ? <text fg={theme.bad}>{`✖ ${whoami.error.message}`}</text> : null}
        {whoami.data && view?.kind === "lines"
          ? view.lines(whoami.data, plainStyle, tui.ctx?.clock.now() ?? new Date()).map((l: string) => (
              <text key={l} fg={theme.fg}>
                {l}
              </text>
            ))
          : null}
        <text fg={theme.dim}>w refresh</text>
      </Panel>
    </box>
  );
}
