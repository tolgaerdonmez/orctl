/**
 * Synthetic authenticated responses in raw API shape (snake_case), built from the documented
 * field lists (scout report §4.2–4.3). All keys and hashes are fake.
 */

export const credits = (total = 50, used = 37.6) => ({ data: { total_credits: total, total_usage: used } });

export function currentKey(over: Record<string, unknown> = {}) {
  return {
    data: {
      label: "sk-or-v1-0e6...1c96",
      limit: 20,
      limit_remaining: 8.1,
      limit_reset: "monthly",
      usage: 11.9,
      usage_daily: 0.4,
      usage_weekly: 2.1,
      usage_monthly: 11.9,
      byok_usage: 0,
      byok_usage_daily: 0,
      byok_usage_weekly: 0,
      byok_usage_monthly: 0,
      include_byok_in_limit: false,
      is_free_tier: false,
      is_management_key: false,
      is_provisioning_key: false,
      allowed_data_regions: ["global"],
      creator_user_id: null,
      expires_at: null,
      free_model_daily_requests: { limit: 1000, remaining: 990, used: 10 },
      organization_id: null,
      rate_limit: { interval: "10s", note: "deprecated", requests: -1 },
      workspace_id: null,
      ...over,
    },
  };
}

export const WS_DEFAULT = "00000000-0000-4000-8000-000000000001";
export const WS_RESEARCH = "00000000-0000-4000-8000-000000000002";
export const WS_PROD = "00000000-0000-4000-8000-000000000003";

export function workspace(id: string, slug: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    slug,
    name,
    description: null,
    created_at: "2026-01-02T03:04:05Z",
    created_by: null,
    updated_at: null,
    default_guardrail_id: "00000000-0000-4000-8000-0000000000aa",
    default_image_model: null,
    default_provider_sort: null,
    default_text_model: null,
    io_logging_api_key_ids: null,
    io_logging_sampling_rate: 0,
    is_data_discount_logging_enabled: false,
    is_observability_broadcast_enabled: false,
    is_observability_io_logging_enabled: false,
    ...over,
  };
}

export const workspaces = (
  list = [
    workspace(WS_DEFAULT, "default", "Default"),
    workspace(WS_RESEARCH, "research", "Research"),
    workspace(WS_PROD, "prod", "Production"),
  ],
) => ({ data: list, total_count: list.length });

export const hash = (seed: string) => {
  const hex = Array.from(seed)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  return hex.padEnd(64, "0").slice(0, 64);
};

export function apiKey(name: string, over: Record<string, unknown> = {}) {
  const h = (over.hash as string) ?? hash(name);
  return {
    hash: h,
    name,
    label: `sk-or-v1-${h.slice(0, 3)}...${h.slice(-4)}`,
    disabled: false,
    limit: null,
    limit_remaining: null,
    limit_reset: null,
    include_byok_in_limit: false,
    usage: 0,
    usage_daily: 0,
    usage_weekly: 0,
    usage_monthly: 0,
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_weekly: 0,
    byok_usage_monthly: 0,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: null,
    expires_at: null,
    external_user: null,
    creator_user_id: null,
    workspace_id: WS_DEFAULT,
    ...over,
  };
}
