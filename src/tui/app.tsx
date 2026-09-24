import { useKeyboard } from "@opentui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, type FunctionComponent } from "react";
import { Confirm } from "./components/dialogs.tsx";
import { Footer, Header, Tabs, Toasts } from "./components/Shell.tsx";
import { DashboardScreen } from "./screens/Dashboard.tsx";
import { HelpScreen } from "./screens/Help.tsx";
import { KeyDetailScreen, KeysScreen } from "./screens/Keys.tsx";
import { ModelDetailScreen } from "./screens/ModelDetail.tsx";
import { ModelsScreen } from "./screens/Models.tsx";
import { Palette, Placeholder, ProfileSwitcher } from "./screens/overlays.tsx";
import { ProfilesScreen } from "./screens/Profiles.tsx";
import { ProfileWizard } from "./screens/ProfileWizard.tsx";
import { ProvidersScreen } from "./screens/Providers.tsx";
import { Layer, type Screen, TABS, type TuiOptions, TuiProvider, useKeys, useTui } from "./state.tsx";

type ScreenComponent = FunctionComponent<{ screen: Screen }>;

/** Screen registry (plan §7.3). Tabs 1–7 plus detail screens pushed on the stack. */
export const SCREENS: Record<string, ScreenComponent> = {
  dashboard: () => <DashboardScreen />,
  profiles: () => <ProfilesScreen />,
  "profile-wizard": ({ screen }) => (
    <ProfileWizard
      mode={(screen.params?.mode as "add" | "edit") ?? "add"}
      name={screen.params?.name as string | undefined}
    />
  ),
  help: () => <HelpScreen />,
  models: () => <ModelsScreen />,
  "model-detail": ({ screen }) => <ModelDetailScreen id={String(screen.params?.id ?? "")} />,
  providers: () => <ProvidersScreen />,
  keys: () => <KeysScreen />,
  "key-detail": ({ screen }) => <KeyDetailScreen hash={String(screen.params?.hash ?? "")} />,
};

function GlobalKeys() {
  const tui = useTui();
  useKeyboard((key) => {
    tui.keys.dispatch(key);
  });
  const quit = () => {
    if (tui.busy > 0) {
      tui.openModal(
        <Confirm
          title="Quit"
          prompt="A change is still in progress. Quit anyway?"
          onConfirm={() => tui.quit(0)}
        />,
      );
      return;
    }
    tui.quit(0);
  };
  useKeys((id) => {
    const n = Number(id);
    if (Number.isInteger(n) && n >= 1 && n <= TABS.length) {
      const tab = TABS[n - 1];
      if (tab) tui.goTab(tab.id);
      return true;
    }
    switch (id) {
      case "ctrl+o":
        tui.openModal(<ProfileSwitcher />);
        return true;
      case "ctrl+p":
        tui.openModal(<Palette />);
        return true;
      case "?":
        if (tui.screen.id !== "help") tui.push({ id: "help" });
        return true;
      case "y":
        if (tui.cliHint) {
          const hint = tui.cliHint;
          tui
            .copy(hint)
            .then(() => tui.toast(`Copied: ${hint}`, "good"))
            .catch(() => tui.toast("Clipboard unavailable", "bad"));
        }
        return true;
      case "r":
      case "ctrl+r":
        void tui.queryClient.invalidateQueries();
        tui.toast("Refreshing…");
        return true;
      case "escape":
        tui.pop();
        return true;
      case "q":
      case "ctrl+c":
        quit();
        return true;
      default:
        return false;
    }
  }, Layer.GLOBAL);
  return null;
}

function Body() {
  const { screen } = useTui();
  const Component = SCREENS[screen.id];
  if (!Component) {
    const title = TABS.find((t) => t.id === screen.id)?.title ?? screen.id;
    return <Placeholder title={title} />;
  }
  return createElement(Component, { key: `${screen.id}:${JSON.stringify(screen.params ?? {})}`, screen });
}

function Shell() {
  const tui = useTui();
  return (
    <QueryClientProvider client={tui.queryClient}>
      <GlobalKeys />
      <box flexDirection="column" width="100%" height="100%">
        <Header />
        <Tabs />
        <box flexDirection="column" flexGrow={1}>
          {tui.ctx || tui.ctxError ? <Body key={tui.ctx?.profile?.name ?? "none"} /> : <text>Loading…</text>}
        </box>
        <Footer />
      </box>
      {tui.modal}
      <Toasts />
    </QueryClientProvider>
  );
}

export function App(props: { options: TuiOptions }) {
  return (
    <TuiProvider options={props.options}>
      <Shell />
    </TuiProvider>
  );
}
