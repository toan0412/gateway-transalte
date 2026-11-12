import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    credentials_enc TEXT NOT NULL DEFAULT '',
    quota_unit TEXT NOT NULL DEFAULT 'chars',
    quota_limit INTEGER NOT NULL DEFAULT 0,
    quota_period TEXT NOT NULL DEFAULT 'day',
    reset_timezone TEXT NOT NULL DEFAULT 'UTC',
    cooldown_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE usage_counters (
    provider_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    units_used INTEGER NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider_id, period_start)
  );
  CREATE TABLE translation_cache (
    hash TEXT PRIMARY KEY,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    last_hit_at INTEGER NOT NULL
  );
  CREATE TABLE request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    gateway_key_id TEXT,
    target_lang TEXT NOT NULL,
    chars INTEGER NOT NULL,
    provider_id TEXT,
    status TEXT NOT NULL,
    fallback_chain TEXT NOT NULL DEFAULT '[]',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    cache_hits INTEGER NOT NULL DEFAULT 0,
    cache_total INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_logs_ts ON request_logs(ts DESC);
  CREATE TABLE gateway_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, value);
}
