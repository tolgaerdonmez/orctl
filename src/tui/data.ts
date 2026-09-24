import { useMutation, useQuery } from "@tanstack/react-query";
import type { OrctlError } from "../core/errors.ts";
import { useTui } from "./state.tsx";

/**
 * react-query bindings (plan §5.6): query keys are [profile, opId, params]; account data lives
 * only in this in-memory cache and is cleared on profile switch.
 */
export function useOp<O>(
  opId: string,
  input: Record<string, unknown> = {},
  opts: { enabled?: boolean } = {},
) {
  const { ctx, runOp } = useTui();
  const profile = ctx?.profile?.name ?? "(none)";
  return useQuery<O, OrctlError>({
    queryKey: [profile, opId, input],
    queryFn: () => runOp<O>(opId, input),
    enabled: Boolean(ctx) && (opts.enabled ?? true),
  });
}

/** Runs a mutating op; on success invalidates every cached query whose op id starts with a prefix. */
export function useOpMutation<O>(opId: string, invalidate: string[] = []) {
  const { runOp, queryClient } = useTui();
  return useMutation<O, OrctlError, Record<string, unknown>>({
    mutationFn: (input) => runOp<O>(opId, input),
    onSuccess: async () => {
      if (invalidate.length === 0) return;
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const op = String(q.queryKey[1] ?? "");
          return invalidate.some((prefix) => op.startsWith(prefix));
        },
      });
    },
  });
}
