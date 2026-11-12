import type { QuotaPeriod } from "@tg/shared";
import type { DB } from "../db/index.js";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Khóa chu kỳ hiện tại (so sánh chuỗi), ví dụ "2026-11-12" cho chu kỳ ngày. */
export function periodKey(period: QuotaPeriod, tz: string, now: number): string {
  if (period === "none") return "all";
  const parts = Object.fromEntries(
    fmt(tz).formatToParts(new Date(now)).map((p) => [p.type, p.value]),
  );
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  if (period === "month") return `${parts.year}-${parts.month}`;
  if (period === "day") return day;
  return `${day}T${parts.hour}:${parts.minute}`;
}

/** Thời điểm (ms) chu kỳ kế tiếp bắt đầu; null nếu không bao giờ đặt lại. */
export function nextReset(period: QuotaPeriod, tz: string, now: number): number | null {
  if (period === "none") return null;
  const start = periodKey(period, tz, now);
  let lo = now;
  let hi = now + 32 * 24 * 3600 * 1000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (periodKey(period, tz, mid) === start) lo = mid;
    else hi = mid;
  }
  return hi;
}

export interface QuotaConfig {
  quota_limit: number;
  quota_period: QuotaPeriod;
  reset_timezone: string;
}

export class QuotaService {
  constructor(
    private db: DB,
    private now: () => number = Date.now,
  ) {}

  used(providerId: string, cfg: QuotaConfig): { units: number; requests: number } {
    const key = periodKey(cfg.quota_period, cfg.reset_timezone, this.now());
    const r = this.db
      .prepare("SELECT units_used, requests FROM usage_counters WHERE provider_id=? AND period_start=?")
      .get(providerId, key) as { units_used: number; requests: number } | undefined;
    return { units: r?.units_used ?? 0, requests: r?.requests ?? 0 };
  }

  /** limit = 0 nghĩa là không giới hạn. threshold ∈ (0,1]. */
  hasRoom(providerId: string, cfg: QuotaConfig, needed: number, threshold: number): boolean {
    if (cfg.quota_limit <= 0) return true;
    const { units } = this.used(providerId, cfg);
    return units + needed <= Math.floor(cfg.quota_limit * threshold);
  }

  record(providerId: string, cfg: QuotaConfig, units: number): void {
    const key = periodKey(cfg.quota_period, cfg.reset_timezone, this.now());
    this.db
      .prepare(
        `INSERT INTO usage_counters(provider_id, period_start, units_used, requests) VALUES(?,?,?,1)
         ON CONFLICT(provider_id, period_start) DO UPDATE SET
           units_used = units_used + excluded.units_used, requests = requests + 1`,
      )
      .run(providerId, key, units);
  }

  resetAt(cfg: QuotaConfig): number | null {
    return nextReset(cfg.quota_period, cfg.reset_timezone, this.now());
  }
}
