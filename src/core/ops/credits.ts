import { z } from "zod";
import { defineOp } from "./types.ts";

/** Account credits (management key). The API has no "remaining" field; it is computed. */
export const creditsGet = defineOp({
  id: "credits.get",
  role: "management",
  kind: "read",
  summary: "Show purchased credits, usage and what is left",
  input: z.object({}),
  async run(ctx) {
    const res = await ctx.sdk.management().credits.getCredits();
    const { totalCredits, totalUsage } = res.data;
    return { totalCredits, totalUsage, remaining: totalCredits - totalUsage };
  },
});
