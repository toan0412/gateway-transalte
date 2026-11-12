import { describe, expect, it } from "vitest";
import { addFake, behaviors, makeApp } from "./helpers.js";

const auth = { authorization: "Bearer test-key" };

describe("public API", () => {
  it("/health không cần key", async () => {
    const { fastify } = await makeApp();
    expect((await fastify.inject("/health")).statusCode).toBe(200);
  });
  it("401 không key", async () => {
    const { fastify } = await makeApp();
    const r = await fastify.inject({ method: "POST", url: "/v1/translate", payload: {} });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("UNAUTHORIZED");
  });
  it("400 đầu vào sai", async () => {
    const { fastify } = await makeApp();
    const r = await fastify.inject({ method: "POST", url: "/v1/translate", headers: auth, payload: { texts: [] } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("INVALID_REQUEST");
  });
  it("dịch end-to-end + providers + languages", async () => {
    const { fastify, app } = await makeApp();
    addFake(app, "a", { limit: 1000 });
    behaviors.a = (t) => t.map((x) => `vi:${x}`);
    const r = await fastify.inject({ method: "POST", url: "/v1/translate", headers: auth, payload: { texts: ["Hello world", "How are you?"], target: "vi" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().translations[1].text).toBe("vi:How are you?");
    const p = await fastify.inject({ url: "/v1/providers", headers: auth });
    expect(p.json().providers[0]).toMatchObject({ id: "a", limit: 1000 });
    expect((await fastify.inject({ url: "/v1/languages", headers: auth })).json().languages.vi).toBeTruthy();
  });
  it("ALL_PROVIDERS_EXHAUSTED khi không có provider", async () => {
    const { fastify } = await makeApp();
    const r = await fastify.inject({ method: "POST", url: "/v1/translate", headers: auth, payload: { texts: ["x"], target: "vi" } });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe("ALL_PROVIDERS_EXHAUSTED");
  });
});

describe("admin API", () => {
  async function login(fastify: any) {
    const r = await fastify.inject({ method: "POST", url: "/admin/api/login", payload: { password: "adminpass1" } });
    expect(r.statusCode).toBe(200);
    return { cookie: `tg_session=${r.cookies[0].value}` };
  }
  it("cần đăng nhập; khóa sau 5 lần sai", async () => {
    const { fastify } = await makeApp();
    expect((await fastify.inject("/admin/api/providers")).statusCode).toBe(401);
    for (let i = 0; i < 5; i++) {
      expect((await fastify.inject({ method: "POST", url: "/admin/api/login", payload: { password: "x" } })).statusCode).toBe(401);
    }
    expect((await fastify.inject({ method: "POST", url: "/admin/api/login", payload: { password: "adminpass1" } })).statusCode).toBe(429);
  });
  it("CRUD provider, che key, thứ tự, key gateway", async () => {
    const { fastify } = await makeApp();
    const h = await login(fastify);
    const c = await fastify.inject({ method: "POST", url: "/admin/api/providers", headers: h, payload: { type: "gemini", name: "Gemini", credentials: { apiKey: "SECRETKEY1234" } } });
    expect(c.statusCode).toBe(201);
    const p = c.json();
    expect(p.credentials.apiKey).toBe("••••1234");
    expect(JSON.stringify(p)).not.toContain("SECRETKEY");
    // PATCH với key đã che giữ nguyên key cũ
    await fastify.inject({ method: "PATCH", url: `/admin/api/providers/${p.id}`, headers: h, payload: { credentials: { apiKey: "••••1234", model: "m" }, enabled: false } });
    const list = (await fastify.inject({ url: "/admin/api/providers", headers: h })).json().providers;
    expect(list[0]).toMatchObject({ enabled: false, credentials: { apiKey: "••••1234", model: "m" } });
    // thứ tự
    const m = await fastify.inject({ method: "POST", url: "/admin/api/providers", headers: h, payload: { type: "mymemory", name: "MM" } });
    await fastify.inject({ method: "PUT", url: "/admin/api/providers/order", headers: h, payload: { ids: [m.json().id, p.id] } });
    expect((await fastify.inject({ url: "/admin/api/providers", headers: h })).json().providers[0].id).toBe(m.json().id);
    // gateway key mới dùng được, thu hồi thì hết
    const k = (await fastify.inject({ method: "POST", url: "/admin/api/keys", headers: h, payload: { name: "ext" } })).json();
    const ok = await fastify.inject({ url: "/v1/languages", headers: { authorization: `Bearer ${k.key}` } });
    expect(ok.statusCode).toBe(200);
    await fastify.inject({ method: "DELETE", url: `/admin/api/keys/${k.id}`, headers: h });
    expect((await fastify.inject({ url: "/v1/languages", headers: { authorization: `Bearer ${k.key}` } })).statusCode).toBe(401);
  });
  it("playground + usage + logs", async () => {
    const { fastify, app } = await makeApp();
    addFake(app, "a"); behaviors.a = (t) => t.map((x) => x + "!");
    const h = await login(fastify);
    const r = await fastify.inject({ method: "POST", url: "/admin/api/playground", headers: h, payload: { text: "hi", target: "vi", provider: "a" } });
    expect(r.json().translations[0].text).toBe("hi!");
    expect((await fastify.inject({ url: "/admin/api/usage", headers: h })).json().providers[0].used).toBe(2);
    expect((await fastify.inject({ url: "/admin/api/logs", headers: h })).json().logs.length).toBe(1);
  });
});
