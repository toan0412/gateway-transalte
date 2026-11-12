import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import type { Config } from "./config.js";
import { type DB, getSetting, setSetting } from "./db/index.js";
import { TranslationCache } from "./core/cache.js";
import { deriveKey, hashPassword, sha256 } from "./core/crypto.js";
import { ProvidersStore } from "./core/providers-store.js";
import { QuotaService } from "./core/quota.js";
import { Router } from "./core/router.js";
import { adminRoutes } from "./routes/admin.js";
import { err, publicRoutes } from "./routes/public.js";

export interface App {
  config: Config;
  db: DB;
  store: ProvidersStore;
  quota: QuotaService;
  cache: TranslationCache;
  router: Router;
}

export async function buildApp(config: Config, db: DB) {
  const store = new ProvidersStore(db, deriveKey(config.masterKey));
  const quota = new QuotaService(db);
  const cache = new TranslationCache(db);
  const router = new Router({ db, store, quota, cache });
  const app: App = { config, db, store, quota, cache, router };

  // khởi tạo mật khẩu admin và gateway key từ biến môi trường
  if (!getSetting(db, "admin_password_hash") && config.adminPassword) {
    setSetting(db, "admin_password_hash", hashPassword(config.adminPassword));
  }
  if (config.bootstrapGatewayKey) {
    db.prepare("INSERT OR IGNORE INTO gateway_keys(id,name,key_hash,created_at) VALUES('bootstrap','bootstrap (env)',?,?)")
      .run(sha256(config.bootstrapGatewayKey), Date.now());
  }

  const fastify = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 1024 * 1024 });
  await fastify.register(cors, { origin: [config.adminOrigin], credentials: true });
  fastify.setErrorHandler((e, _req, reply) => {
    if ((e as any).validation || (e as any).statusCode === 400) {
      return reply.code(400).send(err("INVALID_REQUEST", e.message));
    }
    fastify.log.error(e);
    return reply.code((e as any).statusCode ?? 500).send(err("INTERNAL", "Lỗi nội bộ"));
  });
  await publicRoutes(fastify, app);
  await adminRoutes(fastify, app);

  if (existsSync(config.adminDist)) {
    await fastify.register(fastifyStatic, { root: config.adminDist, prefix: "/admin/" });
    fastify.get("/admin", (_q, r) => r.redirect("/admin/"));
  }
  return { fastify, app };
}
