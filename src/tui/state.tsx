import type { KeyEvent } from "@opentui/core";
import { QueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mapError } from "../core/client/map-error.ts";
import { createContext as createCoreContext, forkContext, type RuntimeDeps } from "../core/context.ts";
import type { OrctlError } from "../core/errors.ts";
import { getOp } from "../core/ops/registry.ts";
import type { CachePolicy, Ctx } from "../core/ops/types.ts";
import type { ResolvedProfile } from "../core/profile/resolve.ts";
import { formatCli } from "../surface/format-cli.ts";
import { keyId } from "./keymap.ts";

// ---------------------------------------------------------------------------------------------
// Screens and navigation (plan §5.6: a simple push/pop/replace stack)

export type TabId = "dashboard" | "keys" | "models" | "providers" | "usage" | "workspaces" | "profiles";
export type ScreenId = TabId | "help";

export interface Screen {
  id: ScreenId | string;
  params?: Record<string, unknown> | undefined;
}

export const TABS: Array<{ id: TabId; title: string }> = [
  { id: "dashboard", title: "Dashboard" },
  { id: "keys", title: "Keys" },
  { id: "models", title: "Models" },
  { id: "providers", title: "Providers" },
  { id: "usage", title: "Usage" },
  { id: "workspaces", title: "Workspaces" },
  { id: "profiles", title: "Profiles" },
];

// ---------------------------------------------------------------------------------------------
// Key routing: one OpenTUI keyboard listener dispatches to layered handlers, highest first.

export const Layer = { GLOBAL: 0, SCREEN: 10, INPUT: 50, MODAL: 100 } as const;

export type KeyHandler = (id: string, key: KeyEvent) => boolean | undefined;

interface Registration {
  priority: number;
  order: number;
  handler: { current: KeyHandler };
}

export class KeyRouter {
  #regs = new Set<Registration>();
  #order = 0;
  add(priority: number, handler: { current: KeyHandler }): () => void {
    const reg = { priority, order: this.#order++, handler };
    this.#regs.add(reg);
    return () => this.#regs.delete(reg);
  }
  dispatch(key: KeyEvent): boolean {
    const id = keyId(key);
    const regs = [...this.#regs].sort((a, b) => b.priority - a.priority || b.order - a.order);
    for (const reg of regs) {
      if (reg.handler.current(id, key) === true) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------

export type Tone = "info" | "good" | "warn" | "bad";

export interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

export interface TuiOptions {
  deps: RuntimeDeps;
  config?: string | undefined;
  profile?: string | undefined;
  screen?: string | undefined;
  onExit(code: number): void;
}

export interface TuiState {
  deps: RuntimeDeps;
  ctx: Ctx | null;
  ctxError: OrctlError | null;
  profile: ResolvedProfile | null;
  queryClient: QueryClient;
  /** Switches the active profile for this session and persists it (profile.use). */
  switchProfile(name: string): Promise<void>;
  /** Rebuilds the context after the config changed (profile add/set/rename/rm). */
  reload(): Promise<void>;
  runOp<O = unknown>(
    opId: string,
    input: Record<string, unknown>,
    opts?: { cachePolicy?: CachePolicy },
  ): Promise<O>;
  screen: Screen;
  stack: Screen[];
  push(screen: Screen): void;
  pop(): void;
  goTab(id: TabId): void;
  cliHint: string | null;
  setCliHint(opId: string | null, input?: Record<string, unknown>): void;
  toasts: Toast[];
  toast(message: string, tone?: Tone): void;
  modal: ReactNode | null;
  openModal(node: ReactNode): void;
  closeModal(): void;
  keys: KeyRouter;
  busy: number;
  quit(code?: number): void;
  copy(text: string): Promise<void>;
}

const TuiContext = createContext<TuiState | null>(null);

export function useTui(): TuiState {
  const state = useContext(TuiContext);
  if (!state) throw new Error("useTui outside TuiProvider");
  return state;
}

/** Registers a key handler for the component's lifetime; the latest closure is always used. */
export function useKeys(handler: KeyHandler, priority: number = Layer.SCREEN, enabled = true): void {
  const { keys } = useTui();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return keys.add(priority, ref);
  }, [keys, priority, enabled]);
}

/** Sets the footer's CLI equivalent for the current screen. */
export function useCliHint(opId: string | null, input: Record<string, unknown> = {}): void {
  const { setCliHint } = useTui();
  const key = JSON.stringify(input);
  // biome-ignore lint/correctness/useExhaustiveDependencies: input is compared by value via key.
  useEffect(() => {
    setCliHint(opId, input);
  }, [opId, key, setCliHint]);
}

export function TuiProvider(props: { options: TuiOptions; children: ReactNode }) {
  const { options } = props;
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [ctxError, setCtxError] = useState<OrctlError | null>(null);
  const [profileName, setProfileName] = useState<string | undefined>(options.profile);
  const [stack, setStack] = useState<Screen[]>(() => [initialScreen(options.screen)]);
  const [cliHint, setCliHintState] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<ReactNode | null>(null);
  const [busy, setBusy] = useState(0);
  const keys = useMemo(() => new KeyRouter(), []);
  const toastId = useRef(0);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
    [],
  );

  const load = useCallback(
    async (name: string | undefined) => {
      try {
        const next = await createCoreContext(options.deps, { profile: name, config: options.config });
        setCtx(next);
        setCtxError(next.profileError ?? null);
      } catch (err) {
        setCtxError(mapError(err));
      }
    },
    [options.deps, options.config],
  );

  useEffect(() => {
    void load(profileName);
  }, [load, profileName]);

  const toast = useCallback((message: string, tone: Tone = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "bad" ? 6000 : 3500);
  }, []);

  const runOp = useCallback(
    async <O,>(opId: string, input: Record<string, unknown>, opts: { cachePolicy?: CachePolicy } = {}) => {
      if (!ctx) throw new Error("context not ready");
      const op = getOp(opId);
      const parsed = op.input.parse(input);
      const opCtx = forkContext(ctx, opts.cachePolicy ? { cachePolicy: opts.cachePolicy } : {});
      const mutation = op.kind !== "read";
      if (mutation) setBusy((b) => b + 1);
      try {
        const out = (await op.run(opCtx, parsed)) as O;
        for (const w of opCtx.meta.warnings) toast(w, "warn");
        return out;
      } catch (err) {
        throw mapError(err, {
          mutation,
          role: op.role === "local" ? undefined : op.role,
          profile: ctx.profile?.name,
          rateLimit: ctx.sdk.rateLimit,
        });
      } finally {
        if (mutation) setBusy((b) => b - 1);
      }
    },
    [ctx, toast],
  );

  const switchProfile = useCallback(
    async (name: string) => {
      if (ctx) {
        await getOp("profile.use").run(forkContext(ctx), { name });
      }
      queryClient.clear();
      setProfileName(name);
      if (name === profileName) await load(name);
    },
    [ctx, queryClient, profileName, load],
  );

  const reload = useCallback(async () => {
    queryClient.clear();
    await load(profileName);
  }, [queryClient, load, profileName]);

  const setCliHint = useCallback(
    (opId: string | null, input: Record<string, unknown> = {}) => {
      if (!opId) return setCliHintState(null);
      try {
        const profile = ctx?.profile && !ctx.profile.ephemeral ? ctx.profile.name : undefined;
        setCliHintState(formatCli(opId, input, { profile: profileName ? profile : undefined }));
      } catch {
        setCliHintState(null);
      }
    },
    [ctx, profileName],
  );

  const state: TuiState = {
    deps: options.deps,
    ctx,
    ctxError,
    profile: ctx?.profile ?? null,
    queryClient,
    switchProfile,
    reload,
    runOp: runOp as TuiState["runOp"],
    screen: stack[stack.length - 1] ?? { id: "dashboard" },
    stack,
    push: (s) => setStack((st) => [...st, s]),
    pop: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
    goTab: (id) => setStack([{ id }]),
    cliHint,
    setCliHint,
    toasts,
    toast,
    modal,
    openModal: setModal,
    closeModal: () => setModal(null),
    keys,
    busy,
    quit: (code = 0) => options.onExit(code),
    copy: async (text) => {
      if (!ctx) return;
      await ctx.clipboard.copy(text);
    },
  };
  return <TuiContext.Provider value={state}>{props.children}</TuiContext.Provider>;
}

function initialScreen(screen: string | undefined): Screen {
  const known = TABS.find((t) => t.id === screen);
  return { id: known?.id ?? "dashboard" };
}
