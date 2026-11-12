export interface Config {
  port: number;
  masterKey: string;
  adminPassword: string;
  publicUrl: string;
  adminOrigin: string;
  dbPath: string;
  bootstrapGatewayKey: string;
  rateLimitPerMinute: number;
  adminDist: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const masterKey = env.MASTER_KEY ?? "";
  if (masterKey.length < 16) {
    throw new Error("MASTER_KEY phải có ít nhất 16 ký tự (xem .env.example)");
  }
  return {
    port: Number(env.PORT ?? 8787),
    masterKey,
    adminPassword: env.ADMIN_PASSWORD ?? "",
    publicUrl: env.PUBLIC_URL ?? "http://localhost:8787",
    adminOrigin: env.ADMIN_ORIGIN ?? "http://localhost:5173",
    dbPath: env.DB_PATH ?? "./data/gateway.db",
    bootstrapGatewayKey: env.BOOTSTRAP_GATEWAY_KEY ?? env.GATEWAY_KEY ?? "",
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 60),
    adminDist: env.ADMIN_DIST ?? new URL("../../admin/dist", import.meta.url).pathname,
  };
}
