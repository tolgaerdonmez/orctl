import { z } from "zod";
import { TTL } from "../cache/disk-cache.ts";
import { OrctlError } from "../errors.ts";
import { nearMatches } from "../format/suggest.ts";
import { type Ctx, defineOp } from "./types.ts";

export interface ProviderItem {
  name: string;
  slug: string;
  headquarters: string | null;
  datacenters: string[];
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  statusPageUrl: string | null;
}

async function allProviders(ctx: Ctx): Promise<ProviderItem[]> {
  const res = await ctx.cache.fetch("providers", TTL.providers, ctx.cachePolicy, async () => {
    const r = await ctx.sdk.public().providers.list();
    return r.data.map(
      (p): ProviderItem => ({
        name: p.name,
        slug: p.slug,
        headquarters: p.headquarters ? String(p.headquarters) : null,
        datacenters: (p.datacenters ?? []).map(String),
        privacyPolicyUrl: p.privacyPolicyUrl,
        termsOfServiceUrl: p.termsOfServiceUrl ?? null,
        statusPageUrl: p.statusPageUrl ?? null,
      }),
    );
  });
  ctx.meta.cached = res.cached;
  ctx.meta.fetchedAt = res.fetchedAt.toISOString();
  if (res.stale) ctx.meta.warnings.push("Network unavailable; showing cached provider data.");
  return res.data;
}

export const providersList = defineOp({
  id: "providers.list",
  role: "public",
  kind: "read",
  summary: "List inference providers",
  input: z.object({ q: z.string().optional() }),
  async run(ctx, input) {
    const q = input.q?.toLowerCase();
    const providers = (await allProviders(ctx))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.slug.includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { providers, count: providers.length };
  },
});

export const providersShow = defineOp({
  id: "providers.show",
  role: "public",
  kind: "read",
  summary: "Show a provider: headquarters, datacenters, policies",
  input: z.object({ slug: z.string().min(1) }),
  async run(ctx, input) {
    const all = await allProviders(ctx);
    const wanted = input.slug.toLowerCase();
    const hit = all.find((p) => p.slug === wanted || p.name.toLowerCase() === wanted);
    if (!hit) {
      const similar = nearMatches(
        input.slug,
        all.map((p) => p.slug),
      );
      throw new OrctlError("NOT_FOUND", `Provider "${input.slug}" was not found.`, {
        hint: similar.length
          ? `Did you mean: ${similar.join(", ")}?`
          : "List them with `orctl providers list`.",
      });
    }
    return hit;
  },
});
