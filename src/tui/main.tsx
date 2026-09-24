import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { RuntimeDeps } from "../core/context.ts";
import { App } from "./app.tsx";

export interface LaunchOptions {
  screen?: string | undefined;
  profile?: string | undefined;
  config?: string | undefined;
}

/**
 * Starts the full-screen TUI (plan §5.6). Loaded only through a dynamic import from main.ts, so
 * CLI commands never pay for OpenTUI's native library. The alternate screen (OpenTUI's default)
 * keeps anything shown in the TUI, such as a new key, out of the terminal scrollback.
 */
export async function launchTui(options: LaunchOptions, deps: RuntimeDeps): Promise<number> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });
  return new Promise<number>((resolve) => {
    let finished = false;
    const root = createRoot(renderer);
    const onExit = (code: number) => {
      if (finished) return;
      finished = true;
      root.unmount();
      renderer.destroy();
      resolve(code);
    };
    // Debug output would corrupt the screen; the TUI never logs to the terminal.
    const tuiDeps: RuntimeDeps = { ...deps, debugSink: () => {} };
    root.render(
      <App
        options={{
          deps: tuiDeps,
          config: options.config,
          profile: options.profile,
          screen: options.screen,
          onExit,
        }}
      />,
    );
  });
}
