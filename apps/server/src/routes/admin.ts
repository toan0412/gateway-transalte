import type { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { z } from "zod";
import type { App } from "../app.js";
import { getSetting, setSetting } from "../db/index.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "../core/crypto.js";
import { GatewayError } from "../core/router.js";
import { getDefinition, listTemplates } from "../providers/registry.js";
import type { Credentials } from "../providers/types.js";
import type { ProviderRow } from "../core/providers-store.js";
import { err } from "./public.js";

const SESSION_MS = 12 * 3600 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const CredSchema = z
  .object({
    apiKey: z.string().optional(),
    accountId: z.string().optional(),
    email: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
  })
  .partial();

const QuotaFields = {
  quota_unit: z.enum(["chars", "requests", "neurons"]),
  quota_limit: z.number().int().min(0),
  quota_period: z.enum(["minute", "day", "month", "none"]),
  reset_timezone: z.string(),
};

const mask = (s?: string) => (s ? `••••${s.slice(-4)}` : "");

export async function adminRoutes(fastify: FastifyInstance, app: App) {
  await fastify.register(cookie);
  const sessions = new Map<string, number>();
  const fails = new Map<string, { n: number; until: number }>();
  const secure = app.config.publicUrl.startsWith("https://");

  const view = (row: ProviderRow) => {
    const c = app.store.credentials(row);
    return {
      id: row.id, type: row.type, name: row.name, enabled: !!row.enabled, priority: row.priority,
      quota_unit: row.quota_unit, quota_limit: row.quota_limit, quota_period: row.quota_period,
      reset_timezone: row.reset_timezone,
      credentials: { ...c, apiKey: mask(c.apiKey), accountId: c.accountId },
      status: app.router.status(row),
    };
  };

  fastify.register(async (api) => {
    api.post("/admin/api/login", async (req, reply) => {
      const ip = req.ip;
      const f = fails.get(ip);
      if (f && f.n >= MAX_FAILS && f.until > Date.now()) {
        return reply.code(429).send(err("RATE_LIMITED", "Đăng nhập bị khóa tạm, thử lại sau"));
      }
      const pw = (req.body as any)?.password;
      const stored = getSetting(app.db, "admin_password_hash");
      if (typeof pw !== "string" || !stored || !verifyPassword(pw, stored)) {
        const n = (f && f.until > Date.now() ? f.n : 0) + 1;
        fails.set(ip, { n, until: Date.now() + LOCK_MS });
        return reply.code(401).send(err("UNAUTHORIZED", "Sai mật khẩu"));
      }
      fails.delete(ip);
      const token = randomToken();
      sessions.set(token, Date.now() + SESSION_MS);
      reply.setCookie("tg_session", token, {
        httpOnly: true, secure, sameSite: "strict", path: "/admin", maxAge: SESSION_MS / 1000,
      });
      return { ok: true };
    });

    api.addHook("onRequest", async (req, reply) => {
      if (req.url.endsWith("/admin/api/login")) return;
      const tok = req.cookies?.tg_session;
      const exp = tok ? sessions.get(tok) : undefined;
      if (!tok || !exp || exp < Date.now()) {
        return reply.code(401).send(err("UNAUTHORIZED", "Cần đăng nhập"));
      }
    });

    api.post("/admin/api/logout", async (req, reply) => {
      if (req.cookies.tg_session) sessions.delete(req.cookies.tg_session);
      reply.clearCookie("tg_session", { path: "/admin" });
      return { ok: true };
    });
    api.get("/admin/api/me", async () => ({ ok: true }));
    api.get("/admin/api/templates", async () => ({ templates: listTemplates() }));

    // ---- providers
    api.get("/admin/api/providers", async () => ({ providers: app.store.list().map(view) }));

    api.post("/admin/api/providers", async (req, reply) => {
      const p = z
        .object({ type: z.string(), name: z.string().min(1), credentials: CredSchema.default({}), enabled: z.boolean().default(true) })
        .merge(z.object(QuotaFields).partial())
        .safeParse(req.body);
      if (!p.success) return reply.code(400).send(err("INVALID_REQUEST", p.error.message));
      const def = getDefinition(p.data.type);
      if (!def) return reply.code(400).send(err("INVALID_REQUEST", `Loại không hỗ trợ: ${p.data.type}`));
      const d = def.template.defaults;
      let id = p.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || p.data.type;
      if (app.store.get(id)) id = `${id}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
      const row = app.store.insert({
        id, type: p.data.type, name: p.data.name, enabled: p.data.enabled ? 1 : 0,
        credentials_enc: app.store.encryptCredentials(p.data.credentials as Credentials),
        quota_unit: (p.data.quota_unit ?? d.quota_unit) as any,
        quota_limit: p.data.quota_limit ?? d.quota_limit,
        quota_period: (p.data.quota_period ?? d.quota_period) as any,
        reset_timezone: p.data.reset_timezone ?? d.reset_timezone,
      });
      return reply.code(201).send(view(row));
    });

    api.patch("/admin/api/providers/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const row = app.store.get(id);
      if (!row) return reply.code(404).send(err("NOT_FOUND", "Không có provider"));
      const p = z
        .object({ name: z.string().min(1), enabled: z.boolean(), credentials: CredSchema, ...QuotaFields })
        .partial()
        .safeParse(req.body);
      if (!p.success) return reply.code(400).send(err("INVALID_REQUEST", p.error.message));
      const { credentials, enabled, ...rest } = p.data;
      const patch: Partial<ProviderRow> = { ...rest } as any;
      if (enabled !== undefined) patch.enabled = enabled ? 1 : 0;
      if (credentials) {
        const merged = { ...app.store.credentials(row) } as Record<string, string | undefined>;
        for (const [k, v] of Object.entries(credentials)) {
          // chuỗi rỗng hoặc dạng đã che nghĩa là "giữ nguyên"
          if (v === undefined || v === "" || v.startsWith("••••")) continue;
          merged[k] = v;
        }
        patch.credentials_enc = app.store.encryptCredentials(merged as Credentials);
      }
      app.store.update(id, patch);
      return view(app.store.get(id)!);
    });

    api.delete("/admin/api/providers/:id", async (req, reply) => {
      const ok = app.store.remove((req.params as any).id);
      return ok ? { ok: true } : reply.code(404).send(err("NOT_FOUND", "Không có provider"));
    });

    api.post("/admin/api/providers/:id/test", async (req, reply) => {
      const row = app.store.get((req.params as any).id);
      if (!row) return reply.code(404).send(err("NOT_FOUND", "Không có provider"));
      const t0 = Date.now();
      const r = await app.store.instantiate(row).testConnection();
      return { ...r, latencyMs: Date.now() - t0 };
    });

    api.put("/admin/api/providers/order", async (req, reply) => {
      const p = z.object({ ids: z.array(z.string()) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send(err("INVALID_REQUEST", p.error.message));
      app.store.setOrder(p.data.ids);
      return { ok: true };
    });

    // ---- usage / logs
    api.get("/admin/api/usage", async () => {
      const logs = app.db
        .prepare("SELECT COALESCE(SUM(cache_hits),0) h, COALESCE(SUM(cache_total),0) t FROM request_logs")
        .get() as { h: number; t: number };
      return {
        providers: app.store.list().map((r) => ({ id: r.id, name: r.name, quota_unit: r.quota_unit, ...app.router.status(r) })),
        cache: { ...app.cache.stats(), hitRate: logs.t ? logs.h / logs.t : 0 },
      };
    });

    api.get("/admin/api/logs", async (req) => {
      const limit = Math.min(Number((req.query as any).limit ?? 100), 500);
      const rows = app.db.prepare("SELECT * FROM request_logs ORDER BY id DESC LIMIT ?").all(limit) as any[];
      return { logs: rows.map((r) => ({ ...r, fallback_chain: JSON.parse(r.fallback_chain) })) };
    });

    // ---- gateway keys
    api.get("/admin/api/keys", async () => ({
      keys: app.db.prepare("SELECT id,name,created_at,revoked_at FROM gateway_keys ORDER BY created_at DESC").all(),
    }));
    api.post("/admin/api/keys", async (req, reply) => {
      const p = z.object({ name: z.string().min(1) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send(err("INVALID_REQUEST", p.error.message));
      const key = `tgk_${randomToken(24)}`;
      const id = randomToken(6);
      app.db.prepare("INSERT INTO gateway_keys(id,name,key_hash,created_at) VALUES(?,?,?,?)").run(id, p.data.name, sha256(key), Date.now());
      return reply.code(201).send({ id, name: p.data.name, key }); // chỉ hiện một lần
    });
    api.delete("/admin/api/keys/:id", async (req, reply) => {
      const r = app.db.prepare("UPDATE gateway_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(Date.now(), (req.params as any).id);
      return r.changes ? { ok: true } : reply.code(404).send(err("NOT_FOUND", "Không có key"));
    });

    // ---- cache, playground, settings
    api.delete("/admin/api/cache", async () => ({ deleted: app.cache.clear() }));

    api.post("/admin/api/playground", async (req, reply) => {
      const p = z.object({ text: z.string().min(1), source: z.string().default("auto"), target: z.string(), provider: z.string().nullable().optional() }).safeParse(req.body);
      if (!p.success) return reply.code(400).send(err("INVALID_REQUEST", p.error.message));
      const t0 = Date.now();
      try {
        const r = await app.router.translate({ texts: [p.data.text], source: p.data.source, target: p.data.target, provider: p.data.provider ?? null, noCache: true });
        return { ...r, latencyMs: Date.now() - t0 };
      } catch (e) {
        if (e instanceof GatewayError) return reply.code(e.status).send(err(e.code, e.message));
        throw e;
      }
    });

    api.get("/admin/api/settings", async () => ({ safety_threshold: app.router.threshold() }));
    api.put("/admin/api/settings", async (req, reply) => {
      const p = z.object({ safety_threshold: z.number().gt(0).max(1) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send(err("INVALID_REQUEST", p.error.message));
      setSetting(app.db, "safety_threshold", String(p.data.safety_threshold));
      return { ok: true };
    });
    api.post("/admin/api/password", async (req, reply) => {
      const p = z.object({ current: z.string(), next: z.string().min(8) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send(err("INVALID_REQUEST", "Mật khẩu mới cần ≥ 8 ký tự"));
      if (!verifyPassword(p.data.current, getSetting(app.db, "admin_password_hash") ?? "")) {
        return reply.code(401).send(err("UNAUTHORIZED", "Mật khẩu hiện tại sai"));
      }
      setSetting(app.db, "admin_password_hash", hashPassword(p.data.next));
      return { ok: true };
    });
  });
}
