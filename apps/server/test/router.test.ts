import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/providers/types.js";
import { addFake, behaviors, calls, makeApp } from "./helpers.js";

const up = (t: string[]) => t.map((x) => x.toUpperCase());
const req = (texts: string[], extra = {}) => ({ texts, source: "auto", target: "vi", noCache: false, ...extra });

describe("router", () => {
  it("dùng provider ưu tiên cao nhất", async () => {
    const { app } = await makeApp();
    addFake(app, "a"); addFake(app, "b");
    behaviors.a = up; behaviors.b = up;
    const r = await app.router.translate(req(["hello"]));
    expect(r.translations[0]).toEqual({ text: "HELLO", provider: "a", cached: false });
    expect(r.fallbackChain).toEqual(["a"]);
  });

  it("429 → tạm nghỉ và fallback", async () => {
    const { app } = await makeApp();
    addFake(app, "a"); addFake(app, "b");
    behaviors.a = () => { throw new ProviderError("quota", "429", 429); };
    behaviors.b = up;
    const r = await app.router.translate(req(["x"]));
    expect(r.fallbackChain).toEqual(["a", "b"]);
    expect(app.store.get("a")!.cooldown_until).toBeGreaterThan(Date.now());
    const r2 = await app.router.translate(req(["y"]));
    expect(r2.fallbackChain).toEqual(["b"]);
  });

  it("lỗi 5xx: thử lại một lần rồi circuit breaker", async () => {
    const { app } = await makeApp();
    addFake(app, "a"); addFake(app, "b");
    behaviors.a = () => { throw new ProviderError("transient", "500", 500); };
    behaviors.b = up;
    await app.router.translate(req(["x"]));
    expect(calls.a).toBe(2);
    expect(app.store.get("a")!.cooldown_until).toBeGreaterThan(Date.now());
  });

  it("hết hạn mức nội bộ → bỏ qua provider (ngưỡng 90%)", async () => {
    const { app } = await makeApp();
    addFake(app, "a", { limit: 100 }); addFake(app, "b");
    behaviors.a = up; behaviors.b = up;
    const big = "x".repeat(80);
    expect((await app.router.translate(req([big]))).fallbackChain).toEqual(["a"]);
    // đã dùng 80, thêm 20 vượt 90
    expect((await app.router.translate(req(["y".repeat(20)]))).fallbackChain).toEqual(["b"]);
  });

  it("mọi provider thất bại → ALL_PROVIDERS_EXHAUSTED", async () => {
    const { app } = await makeApp();
    addFake(app, "a");
    behaviors.a = () => { throw new ProviderError("invalid", "bad", 200); };
    await expect(app.router.translate(req(["x"]))).rejects.toMatchObject({ code: "ALL_PROVIDERS_EXHAUSTED" });
  });

  it("provider chỉ định không tự đổi", async () => {
    const { app } = await makeApp();
    addFake(app, "a"); addFake(app, "b");
    behaviors.a = () => { throw new ProviderError("invalid", "bad"); };
    behaviors.b = up;
    await expect(app.router.translate(req(["x"], { provider: "a" }))).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const r = await app.router.translate(req(["x"], { provider: "b" }));
    expect(r.translations[0].provider).toBe("b");
  });

  it("cache: lần hai cached, quota không tăng", async () => {
    const { app } = await makeApp();
    addFake(app, "a", { limit: 1000 });
    behaviors.a = up;
    await app.router.translate(req(["hello world"]));
    const used1 = app.quota.used("a", app.store.get("a")!).units;
    const r = await app.router.translate(req(["  hello   world "]));
    expect(r.translations[0]).toMatchObject({ cached: true, provider: "cache" });
    expect(r.fallbackChain).toEqual([]);
    expect(app.quota.used("a", app.store.get("a")!).units).toBe(used1);
    expect(calls.a).toBe(1);
  });

  it("giữ thứ tự với văn bản trùng và rỗng", async () => {
    const { app } = await makeApp();
    addFake(app, "a");
    behaviors.a = up;
    const r = await app.router.translate(req(["a", "", "b", "a"]));
    expect(r.translations.map((t) => t.text)).toEqual(["A", "", "B", "A"]);
  });

  it("ghi request_logs", async () => {
    const { app } = await makeApp();
    addFake(app, "a");
    behaviors.a = up;
    await app.router.translate(req(["hi"]));
    const row = app.db.prepare("SELECT * FROM request_logs").get() as any;
    expect(row).toMatchObject({ provider_id: "a", status: "ok", chars: 2 });
  });
});
