import { LANGUAGES, TranslateRequestSchema, type ErrorBody } from "@tg/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { App } from "../app.js";
import { sha256 } from "../core/crypto.js";
import { GatewayError } from "../core/router.js";

export const err = (code: ErrorBody["error"]["code"], message: string): ErrorBody => ({
  error: { code, message },
});

declare module "fastify" {
  interface FastifyRequest {
    gatewayKeyId?: string;
  }
}

export async function publicRoutes(fastify: FastifyInstance, app: App) {
  fastify.get("/health", async () => ({ ok: true }));

  await fastify.register(async (v1) => {
    await v1.register(rateLimit, {
      max: app.config.rateLimitPerMinute,
      timeWindow: "1 minute",
      keyGenerator: (req: FastifyRequest) => req.gatewayKeyId ?? req.ip,
      errorResponseBuilder: () => err("RATE_LIMITED", "Quá giới hạn tốc độ, thử lại sau"),
    });

    v1.addHook("onRequest", async (req, reply) => {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
      const row = m
        ? (app.db
            .prepare("SELECT id FROM gateway_keys WHERE key_hash=? AND revoked_at IS NULL")
            .get(sha256(m[1])) as { id: string } | undefined)
        : undefined;
      if (!row) return reply.code(401).send(err("UNAUTHORIZED", "Gateway key không hợp lệ"));
      req.gatewayKeyId = row.id;
    });

    v1.post("/v1/translate", async (req, reply) => {
      const parsed = TranslateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send(err("INVALID_REQUEST", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
      }
      try {
        return await app.router.translate(parsed.data, { gatewayKeyId: req.gatewayKeyId });
      } catch (e) {
        if (e instanceof GatewayError) return reply.code(e.status).send(err(e.code, e.message));
        throw e;
      }
    });

    v1.get("/v1/providers", async () => ({
      providers: app.store
        .list()
        .filter((p) => p.enabled)
        .map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          priority: p.priority,
          quotaUnit: p.quota_unit,
          ...app.router.status(p),
        })),
    }));

    v1.get("/v1/languages", async () => ({ languages: LANGUAGES }));
  });
}
