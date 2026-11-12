import { describe, expect, it } from "vitest";
import { byteLen, planBatches, splitText } from "../src/core/chunker.js";
import { decrypt, deriveKey, encrypt, hashPassword, verifyPassword } from "../src/core/crypto.js";
import { nextReset, periodKey } from "../src/core/quota.js";
import { parseLlmArray } from "../src/providers/types.js";

describe("chunker", () => {
  it("cắt đoạn dài ≤ giới hạn byte", () => {
    const text = "Hello world. ".repeat(100) + "Xin chào thế giới. ".repeat(30);
    const parts = splitText(text, 500);
    expect(parts.every((p) => byteLen(p) <= 500)).toBe(true);
    expect(parts.join("")).toBe(text);
  });
  it("cắt từ quá dài", () => {
    expect(splitText("a".repeat(1200), 500).map((p) => p.length)).toEqual([500, 500, 200]);
  });
  it("gom lô theo maxItems", () => {
    const b = planBatches(["a", "b", "c"], { maxBytes: 100, maxItems: 1, maxTotalBytes: 100 });
    expect(b.length).toBe(3);
  });
});

describe("quota period", () => {
  const t = Date.UTC(2026, 10, 12, 10, 30);
  it("ngày theo múi giờ", () => {
    expect(periodKey("day", "UTC", t)).toBe("2026-11-12");
    expect(periodKey("day", "Asia/Ho_Chi_Minh", Date.UTC(2026, 10, 12, 18, 0))).toBe("2026-11-13");
  });
  it("thời điểm đặt lại", () => {
    const r = nextReset("day", "UTC", t)!;
    expect(r - Date.UTC(2026, 10, 13)).toBeLessThan(1000);
    expect(r).toBeGreaterThanOrEqual(Date.UTC(2026, 10, 13));
    expect(nextReset("none", "UTC", t)).toBeNull();
    expect(periodKey("month", "UTC", t)).toBe("2026-11");
  });
});

describe("crypto", () => {
  it("mã hóa/giải mã", () => {
    const k = deriveKey("master-key-123456789");
    expect(decrypt(encrypt("secret", k), k)).toBe("secret");
    expect(() => decrypt(encrypt("secret", k), deriveKey("other-key-12345678"))).toThrow();
  });
  it("băm mật khẩu", () => {
    const h = hashPassword("pw");
    expect(verifyPassword("pw", h)).toBe(true);
    expect(verifyPassword("no", h)).toBe(false);
  });
});

describe("parseLlmArray", () => {
  it("parse trong code fence", () => {
    expect(parseLlmArray('```json\n["a","b"]\n```', 2)).toEqual(["a", "b"]);
  });
  it("lệch số phần tử → lỗi", () => {
    expect(() => parseLlmArray('["a"]', 2)).toThrow();
  });
});
