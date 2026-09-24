import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli/program.ts";
import { OPERATIONS } from "../src/core/ops/registry.ts";
import { Secret } from "../src/core/secret.ts";
import { formatCli, splitShellWords } from "../src/surface/format-cli.ts";
import { SPECS } from "../src/surface/spec.ts";
import { harness } from "./helpers.ts";
import { PARITY_SAMPLES } from "./parity-samples.ts";

/**
 * CLI ↔ TUI parity (plan §5.2): (1) every registered operation has a CLI spec and vice versa;
 * (2) every TUI action names a registered operation (checked in the TUI suite); (3) for every
 * operation, parse(formatCli(input)) === input.
 */
describe("parity", () => {
  test("every operation has exactly one CLI spec, and every spec a registered op", () => {
    const opIds = OPERATIONS.map((o) => o.id).sort();
    const specOps = SPECS.map((s) => s.op).sort();
    expect(specOps).toEqual(opIds);
  });

  test("every operation has round-trip samples", () => {
    const missing = OPERATIONS.map((o) => o.id).filter((id) => !PARITY_SAMPLES[id]?.length);
    expect(missing).toEqual([]);
  });

  for (const op of OPERATIONS) {
    for (const [i, sample] of (PARITY_SAMPLES[op.id] ?? []).entries()) {
      test(`${op.id} round-trips (sample ${i + 1})`, async () => {
        const expected = op.input.parse(sample);
        const line = formatCli(op.id, sample as Record<string, unknown>);
        expect(line).not.toContain("sk-or-");
        const secretSample = Object.values(sample).find((v) => v instanceof Secret) as Secret | undefined;
        const h = harness();
        try {
          let captured: Record<string, unknown> | undefined;
          const deps = h.deps({ stdin: secretSample?.reveal() ?? "" });
          const code = await runCli(splitShellWords(line).slice(1), deps, async (spec, input) => {
            expect(spec.op).toBe(op.id);
            captured = input;
            return 0;
          });
          expect(deps.err.join("")).toBe("");
          expect(code).toBe(0);
          const actual = op.input.parse(captured);
          expect(normalize(actual)).toEqual(normalize(expected));
        } finally {
          h.cleanup();
        }
      });
    }
  }
});

function normalize(v: unknown): unknown {
  if (v instanceof Secret) return `secret:${v.reveal()}`;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}
