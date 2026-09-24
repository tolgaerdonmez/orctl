import { afterEach, describe, expect, test } from "bun:test";
import { createClient, MUTATION } from "../../src/core/client/factory.ts";
import { mapError } from "../../src/core/client/map-error.ts";
import { createLogger } from "../../src/core/logger.ts";
import { apiError, FakeFetcher, json } from "../fakes/fetcher.ts";
import { FAKE_MGMT_KEY, FAKE_NEW_KEY } from "../fakes/keys.ts";
import { credits } from "../fixtures/auth.ts";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["OPENROUTER_API_KEY", "OPENROUTER_DEBUG", "OPENROUTER_BASE_URL"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function client(
  role: "public" | "management",
  fetcher: FakeFetcher,
  key: string,
  lines: string[] = [],
  debug = false,
) {
  return createClient(role, key, {
    fetcher: fetcher.fetcher,
    timeoutMs: 2000,
    log: createLogger(debug, (l) => lines.push(l)),
    rateLimit: {},
  });
}

describe("SDK factory traps (plan Ek A-3, §9 S1–S3)", () => {
  test("public requests never carry Authorization, even with OPENROUTER_API_KEY set (S2)", async () => {
    process.env.OPENROUTER_API_KEY = FAKE_MGMT_KEY;
    const f = new FakeFetcher().get("/models/count", { data: { count: 3 } });
    const res = await client("public", f, "").models.count();
    expect(res.data.count).toBe(3);
    expect(f.calls[0]?.headers.authorization).toBeUndefined();
    expect(f.calls[0]?.headers["user-agent"]).toStartWith("orctl/");
  });

  test("management requests send the explicit key", async () => {
    const f = new FakeFetcher().get("/credits", credits());
    await client("management", f, FAKE_MGMT_KEY).credits.getCredits();
    expect(f.calls[0]?.headers.authorization).toBe(`Bearer ${FAKE_MGMT_KEY}`);
  });

  test("OPENROUTER_BASE_URL cannot redirect requests", async () => {
    process.env.OPENROUTER_BASE_URL = "https://evil.example.com/api/v1";
    const f = new FakeFetcher().get("/credits", credits());
    await client("management", f, FAKE_MGMT_KEY).credits.getCredits();
    expect(f.calls[0]?.url.host).toBe("openrouter.ai");
  });

  test("OPENROUTER_DEBUG never routes to console; --debug output is redacted (S1)", async () => {
    process.env.OPENROUTER_DEBUG = "1";
    const printed: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => printed.push(args.join(" "));
    try {
      const f = new FakeFetcher().on(
        "POST",
        "/keys",
        { data: { hash: "x" }, key: FAKE_NEW_KEY },
        { status: 500 },
      );
      const quiet = client("management", f, FAKE_MGMT_KEY);
      await quiet.credits.getCredits().catch(() => {});
      expect(printed.join("\n")).not.toContain(FAKE_MGMT_KEY);
      expect(printed.length).toBe(0);

      const lines: string[] = [];
      const f2 = new FakeFetcher().get("/credits", credits());
      await client("management", f2, FAKE_MGMT_KEY, lines, true).credits.getCredits();
      const out = lines.join("\n");
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain(FAKE_MGMT_KEY);
      expect(out.toLowerCase()).toContain("authorization");
    } finally {
      console.log = original;
    }
  });

  test("mutations are sent exactly once on 503 (S3)", async () => {
    const f = new FakeFetcher().on("POST", "/keys", () => apiError(503, "busy"));
    const c = client("management", f, FAKE_MGMT_KEY);
    await expect(c.apiKeys.create({ requestBody: { name: "x" } }, MUTATION)).rejects.toBeDefined();
    expect(f.callsTo("POST", "/keys").length).toBe(1);
  });

  test("429 maps to RATE_LIMIT with Retry-After in the hint", async () => {
    const rateLimit = {};
    const f = new FakeFetcher().get("/credits", () => apiError(429, "slow down", { "retry-after": "7" }));
    const c = createClient("management", FAKE_MGMT_KEY, {
      fetcher: f.fetcher,
      timeoutMs: 2000,
      log: createLogger(false, () => {}),
      rateLimit,
    });
    const err = await c.credits.getCredits(undefined, { retries: { strategy: "none" } }).catch((e) => e);
    const mapped = mapError(err, { rateLimit });
    expect(mapped.code).toBe("RATE_LIMIT");
    expect(mapped.exit).toBe(7);
    expect(mapped.hint).toContain("7s");
  });

  test("error mapping keeps no raw response and redacts bodies", async () => {
    const f = new FakeFetcher().get("/credits", () =>
      json({ error: { message: `bad key ${FAKE_MGMT_KEY}` } }, 401),
    );
    const err = await client("management", f, FAKE_MGMT_KEY)
      .credits.getCredits()
      .catch((e) => e);
    const mapped = mapError(err, { role: "management", profile: "personal" });
    expect(mapped.code).toBe("AUTH");
    expect(mapped.exit).toBe(4);
    expect(JSON.stringify(mapped.toJSON())).not.toContain(FAKE_MGMT_KEY);
    expect(mapped.hint).toContain("personal");
  });

  test("network failures on mutations become UNKNOWN_OUTCOME (exit 12)", async () => {
    const f = new FakeFetcher().on("POST", "/keys", () => {
      throw new TypeError("fetch failed");
    });
    const err = await client("management", f, FAKE_MGMT_KEY)
      .apiKeys.create({ requestBody: { name: "x" } }, MUTATION)
      .catch((e) => e);
    expect(mapError(err, { mutation: true }).exit).toBe(12);
    expect(mapError(err, { mutation: false }).exit).toBe(10);
  });
});
