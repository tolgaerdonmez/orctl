import { describe, expect, test } from "bun:test";
import type { KeyItem } from "../../src/core/ops/keys.ts";
import { describePlan, planRotation } from "../../src/core/ops/rotate.ts";
import { WS_RESEARCH } from "../fixtures/auth.ts";

const now = new Date("2026-09-24T12:00:00Z");
const key = (over: Partial<KeyItem> = {}): KeyItem =>
  ({
    hash: "a".repeat(64),
    name: "ci-bot",
    label: "sk-or-v1-aaa...aaaa",
    disabled: false,
    limit: 50,
    limitRemaining: 10,
    limitReset: "monthly",
    includeByokInLimit: true,
    usage: 40,
    usageDaily: 0,
    usageWeekly: 0,
    usageMonthly: 40,
    byokUsage: 0,
    byokUsageDaily: 0,
    byokUsageWeekly: 0,
    byokUsageMonthly: 0,
    createdAt: "2026-06-26T12:00:00Z",
    updatedAt: null,
    expiresAt: null,
    externalUser: null,
    creatorUserId: null,
    workspaceId: WS_RESEARCH,
    workspaceSlug: "research",
    workspaceName: "Research",
    ...over,
  }) as KeyItem;

describe("rotation planner (plan §8.1, pure)", () => {
  test("same name; limit, reset, BYOK and workspace carried; old renamed", () => {
    const p = planRotation(key(), {}, now);
    expect(p.newName).toBe("ci-bot");
    expect(p.oldRename).toBe("ci-bot (rotated 2026-09-24)");
    expect(p.createBody).toEqual({
      name: "ci-bot",
      limit: 50,
      limitReset: "monthly",
      includeByokInLimit: true,
      workspaceId: WS_RESEARCH,
    });
    expect(p.expiresAt).toBeNull();
    expect(p.warnings.join(" ")).toContain("start from zero");
  });

  test("expiry: flag wins; otherwise the old lifetime length from now; second precision", () => {
    expect(planRotation(key(), { expires: "30d" }, now).expiresAt?.toISOString()).toBe(
      "2026-10-24T12:00:00.000Z",
    );
    const p = planRotation(key({ expiresAt: new Date("2026-12-24T12:00:00.500Z") }), {}, now);
    expect(p.expiresReason).toBe("same-lifetime");
    expect(p.expiresAt?.toISOString()).toBe("2027-03-24T12:00:00.000Z");
  });

  test("no limit / no reset are not sent; describePlan names profile, workspace and fate", () => {
    const p = planRotation(key({ limit: null, limitReset: null }), { deleteOld: true }, now);
    expect(p.createBody).not.toHaveProperty("limit");
    expect(p.createBody).not.toHaveProperty("limitReset");
    expect(describePlan(p, "acme")).toContain("in profile acme / workspace research");
    expect(describePlan(p, "acme")).toContain("then delete the old key");
    expect(describePlan(planRotation(key(), { keepOldEnabled: true }, now), "acme")).toContain(
      "keep it enabled",
    );
  });
});
