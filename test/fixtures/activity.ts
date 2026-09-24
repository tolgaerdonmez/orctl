import type { FakeFetcher, RecordedRequest } from "../fakes/fetcher.ts";
import { json } from "../fakes/fetcher.ts";
import { WS_DEFAULT, WS_RESEARCH } from "./auth.ts";
import { LAPTOP_HASH } from "./keys.ts";

/** Synthetic GET /activity rows (raw API shape) for the 30 days before 2026-09-24. */
interface Row {
  date: string;
  model: string;
  provider: string;
  usage: number;
  requests: number;
  prompt: number;
  completion: number;
  workspace: string;
  key?: string;
}

const rows: Row[] = [];
const days = ["2026-08-20", "2026-08-26", "2026-09-10", "2026-09-18", "2026-09-22", "2026-09-23"];
for (const [i, date] of days.entries()) {
  rows.push({
    date,
    model: "anthropic/claude-sonnet-5",
    provider: "Anthropic",
    usage: 2 + i,
    requests: 10,
    prompt: 1000,
    completion: 500,
    workspace: WS_DEFAULT,
  });
  rows.push({
    date,
    model: "openai/gpt-6-luna",
    provider: "OpenAI",
    usage: 1,
    requests: 5,
    prompt: 800,
    completion: 200,
    workspace: WS_RESEARCH,
    key: LAPTOP_HASH,
  });
  rows.push({
    date,
    model: "openai/gpt-6-luna",
    provider: "Azure",
    usage: 0.5,
    requests: 2,
    prompt: 100,
    completion: 50,
    workspace: WS_DEFAULT,
  });
}
export const ACTIVITY_ROWS = rows;

function raw(r: Row, withWorkspace: boolean) {
  return {
    date: `${r.date} 00:00:00`,
    model: r.model,
    model_permaslug: `${r.model}-20260101`,
    endpoint_id: `ep-${r.provider}`,
    provider_name: r.provider,
    usage: r.usage,
    byok_usage_inference: 0,
    requests: r.requests,
    prompt_tokens: r.prompt,
    completion_tokens: r.completion,
    reasoning_tokens: 0,
    ...(withWorkspace ? { workspace_id: r.workspace } : {}),
  };
}

export function serveActivity(f: FakeFetcher): void {
  f.get("/activity", (req: RecordedRequest) => {
    const byWorkspace = req.query.group_by === "workspace";
    let list = rows.filter((r) => r.date >= "2026-08-25");
    if (req.query.api_key_hash) list = list.filter((r) => r.key === req.query.api_key_hash);
    if (req.query.workspace_id) list = list.filter((r) => r.workspace === req.query.workspace_id);
    return json({ data: list.map((r) => raw(r, byWorkspace)) });
  });
}
