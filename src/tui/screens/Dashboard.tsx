import type { ReactNode } from "react";
import { formatUsd, percentUsed } from "../../core/format/money.ts";
import { daysUntil, relativeTime } from "../../core/format/time.ts";
import { plainStyle } from "../../core/format/view.ts";
import { type CreditsResult, creditsLines, keyStatus, shortLabel } from "../../core/format/views-keys.ts";
import { profileViews } from "../../core/format/views-profile.ts";
import type { WhoamiResult } from "../../core/ops/auth.ts";
import { Panel } from "../components/Shell.tsx";
import { useOp } from "../data.ts";
import { useCliHint, useKeys, useTui } from "../state.tsx";
import { theme } from "../theme.ts";
import type { KeysResult } from "./Keys.tsx";

/** Extra dashboard cards from later phases (e.g. top models by spend). */
export type DashboardCard = () => ReactNode;

function Lines(props: { lines: string[]; color?: string }) {
  return (
    <>
      {props.lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static line list.
        <text key={i} fg={props.color ?? theme.fg}>
          {l}
        </text>
      ))}
    </>
  );
}

/**
 * Dashboard (plan §7.3): whoami, credits, keys expiring within 14 days and keys above 80% of their
 * limit. Without a profile it offers to add one and points at the public model browser.
 */
export function DashboardScreen(props: { cards?: DashboardCard[] }) {
  const tui = useTui();
  const hasProfile = Boolean(tui.profile);
  const hasMgmt = Boolean(tui.profile?.managementRef);
  const whoami = useOp<WhoamiResult>("auth.whoami", {}, { enabled: hasProfile });
  const credits = useOp<CreditsResult>("credits.get", {}, { enabled: hasMgmt });
  const keys = useOp<KeysResult>("keys.list", {}, { enabled: hasMgmt });
  useCliHint(hasProfile ? "auth.whoami" : "profile.add", hasProfile ? {} : { name: "personal" });
  useKeys((id) => {
    if (id === "w" && hasProfile) {
      void whoami.refetch();
      void credits.refetch();
      void keys.refetch();
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
  const now = tui.ctx?.clock.now() ?? new Date();
  const view = profileViews["auth.whoami"];
  const active = (keys.data?.keys ?? []).filter((k) => keyStatus(k, now) === "active");
  const expiring = active
    .filter((k) => {
      const d = daysUntil(k.expiresAt as Date | null, now);
      return d !== null && d < 14;
    })
    .slice(0, 6);
  const nearLimit = active.filter((k) => (percentUsed(k.limit, k.limitRemaining) ?? 0) > 0.8).slice(0, 6);
  return (
    <box flexDirection="column" flexGrow={1}>
      <Panel title="Who am I">
        {whoami.isLoading ? <text fg={theme.muted}>Checking keys…</text> : null}
        {whoami.error ? <text fg={theme.bad}>{`✖ ${whoami.error.message}`}</text> : null}
        {whoami.data && view?.kind === "lines" ? (
          <Lines lines={view.lines(whoami.data, plainStyle, now)} />
        ) : null}
      </Panel>
      {hasMgmt ? (
        <box flexDirection="row">
          <Panel title="Credits" width="34%">
            {credits.error ? <text fg={theme.bad}>{`✖ ${credits.error.message}`}</text> : null}
            {credits.data ? (
              <Lines lines={creditsLines(credits.data, plainStyle)} />
            ) : (
              <text fg={theme.muted}>…</text>
            )}
          </Panel>
          <Panel title="Expiring within 14 days" width="33%">
            {keys.data && expiring.length === 0 ? <text fg={theme.muted}>None.</text> : null}
            <Lines
              color={theme.warn}
              lines={expiring.map(
                (k) => `${k.name} ${shortLabel(k.label)} · ${relativeTime(k.expiresAt as Date, now)}`,
              )}
            />
          </Panel>
          <Panel title="Above 80% of limit">
            {keys.data && nearLimit.length === 0 ? <text fg={theme.muted}>None.</text> : null}
            <Lines
              color={theme.warn}
              lines={nearLimit.map(
                (k) => `${k.name} · ${formatUsd(k.limitRemaining)} left of ${formatUsd(k.limit)}`,
              )}
            />
          </Panel>
        </box>
      ) : null}
      {props.cards?.map((Card, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static card list.
        <Card key={i} />
      ))}
      <text fg={theme.dim}>w refresh</text>
    </box>
  );
}
