import type { KeyInput } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../../src/tui/app.tsx";
import type { Harness } from "../helpers.ts";

type Mods = { ctrl?: boolean; shift?: boolean; meta?: boolean };

export interface TuiDriver {
  frame(): string;
  press(key: KeyInput, mods?: Mods): Promise<void>;
  keys(...keys: KeyInput[]): Promise<void>;
  type(text: string): Promise<void>;
  paste(text: string): Promise<void>;
  enter(): Promise<void>;
  escape(): Promise<void>;
  waitFor(predicate: (frame: string) => boolean, what?: string): Promise<string>;
  exitCode(): number | undefined;
  destroy(): Promise<void>;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

export async function renderTui(
  h: Harness,
  opts: { width?: number; height?: number; screen?: string; profile?: string } = {},
): Promise<TuiDriver> {
  let exit: number | undefined;
  const t = await testRender(
    <App
      options={{
        deps: h.deps(),
        screen: opts.screen,
        profile: opts.profile,
        onExit: (code) => {
          exit = code;
        },
      }}
    />,
    { width: opts.width ?? 110, height: opts.height ?? 30 },
  );
  const settle = async () => {
    await act(async () => {
      await tick();
    });
    await t.renderOnce();
  };
  const driver: TuiDriver = {
    frame: () => t.captureCharFrame(),
    async press(key, mods) {
      await act(async () => {
        t.mockInput.pressKey(key, mods);
      });
      await settle();
    },
    async keys(...keys) {
      for (const k of keys) await driver.press(k);
    },
    async type(text) {
      for (const ch of text) await driver.press(ch);
    },
    async paste(text) {
      await act(async () => {
        await t.mockInput.pasteBracketedText?.(text);
      });
      await settle();
    },
    enter: () => driver.press("RETURN"),
    async escape() {
      // A lone ESC is ambiguous (it may start a sequence); let the parser's timeout flush it.
      await act(async () => {
        t.mockInput.pressEscape();
        await new Promise((r) => setTimeout(r, 60));
      });
      await settle();
    },
    async waitFor(predicate, what = "frame condition") {
      for (let i = 0; i < 200; i++) {
        await settle();
        const f = t.captureCharFrame();
        if (predicate(f)) return f;
        await tick();
      }
      throw new Error(`timed out waiting for ${what}:\n${t.captureCharFrame()}`);
    },
    exitCode: () => exit,
    async destroy() {
      await act(async () => {
        t.renderer.destroy();
      });
    },
  };
  await driver.waitFor((f) => !f.includes("Loading…"), "initial load");
  return driver;
}
