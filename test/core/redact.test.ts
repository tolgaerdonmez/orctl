import { describe, expect, test } from "bun:test";
import { createLogger } from "../../src/core/logger.ts";
import { containsKeyMaterial, maskKey, redact, redactValue } from "../../src/core/redact.ts";
import { Secret } from "../../src/core/secret.ts";
import { FAKE_MGMT_KEY, FAKE_NEW_KEY, FAKE_USER_KEY } from "../fakes/keys.ts";

describe("redaction (plan §9 S1/S8)", () => {
  test("masks full keys to the last four characters", () => {
    expect(maskKey(FAKE_USER_KEY)).toBe(`sk-or-…${FAKE_USER_KEY.slice(-4)}`);
    const text = `key=${FAKE_USER_KEY} and ${FAKE_MGMT_KEY}`;
    const out = redact(text);
    expect(out).not.toContain(FAKE_USER_KEY);
    expect(out).not.toContain(FAKE_MGMT_KEY);
    expect(containsKeyMaterial(out)).toBe(false);
  });

  test("leaves the server's short masked label readable", () => {
    expect(redact("label sk-or-v1-0e6...1c96")).toBe("label sk-or-v1-0e6...1c96");
  });

  test("redacts Authorization headers and JSON key fields", () => {
    expect(redact("authorization: Bearer abcdefghijklmnop")).toBe("authorization: Bearer ***");
    expect(redact('{"data":{},"key":"whatever-secret"}')).toBe('{"data":{},"key":"***"}');
  });

  test("redactValue blanks sensitive fields deeply", () => {
    const v = redactValue({
      a: { key: FAKE_NEW_KEY, list: [FAKE_USER_KEY] },
      Authorization: "Bearer x",
    }) as Record<string, unknown>;
    expect(JSON.stringify(v)).not.toContain(FAKE_NEW_KEY);
    expect(JSON.stringify(v)).not.toContain(FAKE_USER_KEY);
    expect((v.a as Record<string, unknown>).key).toBe("***");
    expect(v.Authorization).toBe("***");
  });

  test("Secret never serializes its value", () => {
    const s = new Secret(FAKE_MGMT_KEY);
    expect(JSON.stringify({ s })).toBe('{"s":"[secret]"}');
    expect(`${s}`).toBe("[secret]");
    expect(Bun.inspect(s)).not.toContain(FAKE_MGMT_KEY);
    expect(s.reveal()).toBe(FAKE_MGMT_KEY);
  });

  test("debug logger redacts and is silent when disabled", () => {
    const lines: string[] = [];
    const off = createLogger(false, (l) => lines.push(l));
    off.log(`Authorization: Bearer ${FAKE_MGMT_KEY}`);
    expect(lines).toEqual([]);
    const on = createLogger(true, (l) => lines.push(l));
    on.group("Request");
    on.log("authorization:", `Bearer ${FAKE_MGMT_KEY}`);
    on.log({ key: FAKE_NEW_KEY, data: { name: "x" } });
    on.groupEnd();
    const text = lines.join("\n");
    expect(text).not.toContain(FAKE_MGMT_KEY);
    expect(text).not.toContain(FAKE_NEW_KEY);
    expect(text).toContain("Request");
  });
});
