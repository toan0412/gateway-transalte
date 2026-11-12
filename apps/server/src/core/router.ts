import type { ErrorCode, TranslateRequest, TranslateResponse } from "@tg/shared";
import type { DB } from "../db/index.js";
import { getSetting } from "../db/index.js";
import { ProviderError, type TranslationProvider } from "../providers/types.js";
import { type TranslationCache, normalize } from "./cache.js";
import { assemble, planBatches, type Piece } from "./chunker.js";
import type { ProviderRow, ProvidersStore } from "./providers-store.js";
import type { QuotaService } from "./quota.js";

export class GatewayError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface RouterDeps {
  db: DB;
  store: ProvidersStore;
  quota: QuotaService;
  cache: TranslationCache;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  breakerMs?: number;
}

export interface TranslateContext {
  gatewayKeyId?: string | null;
}

export class Router {
  private now: () => number;
  private breakerMs: number;
  constructor(private d: RouterDeps) {
    this.now = d.now ?? Date.now;
    this.breakerMs = d.breakerMs ?? 60_000;
  }

  threshold(): number {
    const v = Number(getSetting(this.d.db, "safety_threshold") ?? 0.9);
    return v > 0 && v <= 1 ? v : 0.9;
  }

  /** Số đơn vị quota cần cho các văn bản này (ước lượng). */
  private needed(row: ProviderRow, texts: string[]): number {
    return row.quota_unit === "requests" ? 1 : texts.reduce((a, t) => a + t.length, 0);
  }

  status(row: ProviderRow) {
    const used = this.d.quota.used(row.id, row);
    return {
      used: used.units,
      requests: used.requests,
      limit: row.quota_limit,
      resetsAt: this.d.quota.resetAt(row),
      cooldownUntil: row.cooldown_until > this.now() ? row.cooldown_until : null,
    };
  }

  async translate(req: TranslateRequest, ctx: TranslateContext = {}): Promise<TranslateResponse> {
    const t0 = this.now();
    const source = req.source || "auto";
    const chain: string[] = [];
    let finalProvider: string | null = null;
    let status = "ok";
    const chars = req.texts.reduce((a, t) => a + t.length, 0);
    let cacheHits = 0;
    let uniqueCount = 0;
    try {
      // 1. cache (theo từng đoạn, đã chuẩn hóa)
      const unique = [...new Set(req.texts.map(normalize))];
      uniqueCount = unique.length;
      const cached = req.noCache
        ? new Map<string, { text: string; provider: string }>()
        : this.d.cache.getMany(source, req.target, unique);
      cacheHits = cached.size;
      const missing = unique.filter((t) => !cached.has(t) && t !== "");
      const fresh = new Map<string, string>();
      if (missing.length) {
        const r = await this.callProviders(missing, source, req.target, req.provider ?? null, chain);
        finalProvider = r.provider;
        missing.forEach((t, i) => fresh.set(t, r.translations[i]));
        this.d.cache.putMany(source, req.target, missing.map((t) => ({ text: t, translated: fresh.get(t)! })), r.provider);
      }
      const translations = req.texts.map((t) => {
        const n = normalize(t);
        if (n === "") return { text: t, provider: "cache", cached: true };
        const c = cached.get(n);
        if (c) return { text: c.text, provider: "cache", cached: true };
        return { text: fresh.get(n)!, provider: finalProvider!, cached: false };
      });
      return { translations, fallbackChain: chain };
    } catch (e: any) {
      status = e instanceof GatewayError ? e.code : "INTERNAL";
      throw e;
    } finally {
      this.d.db
        .prepare(
          `INSERT INTO request_logs(ts,gateway_key_id,target_lang,chars,provider_id,status,fallback_chain,latency_ms,cache_hits,cache_total)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(t0, ctx.gatewayKeyId ?? null, req.target, chars, finalProvider, status, JSON.stringify(chain), this.now() - t0, cacheHits, uniqueCount);
    }
  }

  private candidates(texts: string[], forced: string | null): ProviderRow[] {
    const now = this.now();
    const th = this.threshold();
    const rows = this.d.store.list();
    if (forced) {
      const row = rows.find((r) => r.id === forced);
      if (!row) throw new GatewayError("INVALID_REQUEST", `Không có provider "${forced}"`, 400);
      const reason = !row.enabled
        ? "đang tắt"
        : row.cooldown_until > now
          ? "đang tạm nghỉ"
          : !this.d.quota.hasRoom(row.id, row, this.needed(row, texts), th)
            ? "hết quota"
            : null;
      if (reason) throw new GatewayError("PROVIDER_UNAVAILABLE", `Provider "${forced}" ${reason}`, 503);
      return [row];
    }
    return rows.filter(
      (r) => r.enabled && r.cooldown_until <= now && this.d.quota.hasRoom(r.id, r, this.needed(r, texts), th),
    );
  }

  private async callProviders(texts: string[], source: string, target: string, forced: string | null, chain: string[]) {
    const list = this.candidates(texts, forced);
    let lastErr = "";
    for (const row of list) {
      chain.push(row.id);
      try {
        const impl = this.d.store.instantiate(row);
        const out = await this.withRetry(() => this.runProvider(impl, texts, source, target));
        const units = row.quota_unit === "requests" ? out.requests : out.charsUsed;
        this.d.quota.record(row.id, row, units);
        return { provider: row.id, translations: out.translations };
      } catch (e: any) {
        lastErr = e?.message ?? String(e);
        this.penalize(row, e);
        if (forced) throw new GatewayError("PROVIDER_UNAVAILABLE", `Provider "${forced}" lỗi: ${lastErr}`, 502);
      }
    }
    throw new GatewayError(
      "ALL_PROVIDERS_EXHAUSTED",
      list.length ? `Mọi provider đều thất bại (lỗi cuối: ${lastErr})` : "Không còn provider nào khả dụng",
      503,
    );
  }

  /** Lỗi mạng/5xx: thử lại một lần (quy tắc điều phối số 5). */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "transient") {
        await (this.d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(200);
        return fn();
      }
      throw e;
    }
  }

  private penalize(row: ProviderRow, e: unknown) {
    const now = this.now();
    if (e instanceof ProviderError && e.kind === "quota") {
      const reset = this.d.quota.resetAt(row);
      this.d.store.setCooldown(row.id, reset ?? now + this.breakerMs);
    } else if (e instanceof ProviderError && e.kind === "invalid") {
      // lệch định dạng: chỉ fallback, không tạm nghỉ
    } else {
      this.d.store.setCooldown(row.id, now + this.breakerMs);
    }
  }

  private async runProvider(impl: TranslationProvider, texts: string[], source: string, target: string) {
    const maxBytes = impl.maxBytesPerRequest ?? impl.maxCharsPerRequest;
    const batches = planBatches(texts, {
      maxBytes,
      maxItems: impl.maxItemsPerRequest ?? 100,
      maxTotalBytes: impl.maxCharsPerRequest * (impl.kind === "llm" ? 3 : 1),
    });
    const outPieces: Piece[] = [];
    let charsUsed = 0;
    for (const b of batches) {
      const r = await impl.translate({ texts: b.map((p) => p.text), source, target });
      if (r.translations.length !== b.length) {
        throw new ProviderError("invalid", `Provider trả ${r.translations.length} phần tử, cần ${b.length}`);
      }
      b.forEach((p, i) => outPieces.push({ index: p.index, text: r.translations[i] }));
      charsUsed += r.charsUsed;
    }
    return { translations: assemble(texts.length, outPieces), charsUsed, requests: batches.length };
  }
}
