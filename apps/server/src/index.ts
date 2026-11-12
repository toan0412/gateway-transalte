import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { openDb } from "./db/index.js";

const config = loadConfig();
const db = openDb(config.dbPath);
const { fastify, app } = await buildApp(config, db);

// Lần chạy đầu: thêm sẵn MyMemory (không cần key) để /v1/translate dùng được ngay
if (app.store.list().length === 0) {
  app.store.insert({
    id: "mymemory", type: "mymemory", name: "MyMemory", enabled: 1,
    credentials_enc: app.store.encryptCredentials({}),
    quota_unit: "chars", quota_limit: 5000, quota_period: "day", reset_timezone: "UTC",
  });
}
await fastify.listen({ port: config.port, host: "0.0.0.0" });
