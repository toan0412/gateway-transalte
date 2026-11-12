import { buildApp } from "../src/app.js";
import { openDb } from "../src/db/index.js";
import { registerDefinition } from "../src/providers/registry.js";
import { ProviderError, type ProviderDefinition } from "../src/providers/types.js";

export const behaviors: Record<string, (texts: string[]) => string[] | Promise<string[]>> = {};
export const calls: Record<string, number> = {};

export const fakeDef: ProviderDefinition = {
  template: {
    type: "fake", label: "Fake", kind: "mt", fields: [],
    defaults: { quota_unit: "chars", quota_limit: 0, quota_period: "day", reset_timezone: "UTC" },
  },
  create(id) {
    return {
      id, kind: "mt", maxCharsPerRequest: 1000,
      async translate({ texts }) {
        calls[id] = (calls[id] ?? 0) + 1;
        const fn = behaviors[id];
        if (!fn) throw new ProviderError("transient", "no behavior");
        const translations = await fn(texts);
        return { translations, charsUsed: texts.reduce((a, t) => a + t.length, 0) };
      },
      async testConnection() { return { ok: true }; },
    };
  },
};
registerDefinition(fakeDef);

export async function makeApp(env: Record<string, string> = {}) {
  process.env.NODE_ENV = "test";
  const config = {
    port: 0, masterKey: "test-master-key-0123456789", adminPassword: "adminpass1",
    publicUrl: "http://localhost", adminOrigin: "http://localhost:5173", dbPath: ":memory:",
    bootstrapGatewayKey: "test-key", rateLimitPerMinute: 1000, adminDist: "/nonexistent", ...env,
  };
  const db = openDb(":memory:");
  const built = await buildApp(config as any, db);
  for (const k of Object.keys(behaviors)) delete behaviors[k];
  for (const k of Object.keys(calls)) delete calls[k];
  return built;
}

export function addFake(app: any, id: string, o: { limit?: number; unit?: string; period?: string } = {}) {
  app.store.insert({
    id, type: "fake", name: id, enabled: 1, credentials_enc: "",
    quota_unit: (o.unit ?? "chars") as any, quota_limit: o.limit ?? 0,
    quota_period: (o.period ?? "day") as any, reset_timezone: "UTC",
  });
}
