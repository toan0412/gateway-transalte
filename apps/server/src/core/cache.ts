import type { DB } from "../db/index.js";
import { sha256 } from "./crypto.js";

export const normalize = (t: string) => t.trim().replace(/\s+/g, " ");
export const cacheKey = (source: string, target: string, text: string) =>
  sha256(`${source}\u0000${target}\u0000${normalize(text)}`);

export class TranslationCache {
  constructor(
    private db: DB,
    private now: () => number = Date.now,
  ) {}

  getMany(source: string, target: string, texts: string[]): Map<string, { text: string; provider: string }> {
    const found = new Map<string, { text: string; provider: string }>();
    const sel = this.db.prepare("SELECT translated_text, provider_id FROM translation_cache WHERE hash=?");
    const upd = this.db.prepare("UPDATE translation_cache SET hits=hits+1, last_hit_at=? WHERE hash=?");
    for (const t of texts) {
      const h = cacheKey(source, target, t);
      const r = sel.get(h) as { translated_text: string; provider_id: string } | undefined;
      if (r) {
        upd.run(this.now(), h);
        found.set(t, { text: r.translated_text, provider: r.provider_id });
      }
    }
    return found;
  }

  putMany(source: string, target: string, items: { text: string; translated: string }[], provider: string): void {
    const ins = this.db.prepare(
      `INSERT INTO translation_cache(hash,source_lang,target_lang,source_text,translated_text,provider_id,hits,last_hit_at)
       VALUES(?,?,?,?,?,?,0,?)
       ON CONFLICT(hash) DO UPDATE SET translated_text=excluded.translated_text, provider_id=excluded.provider_id`,
    );
    this.db.transaction(() => {
      for (const i of items) ins.run(cacheKey(source, target, i.text), source, target, i.text, i.translated, provider, this.now());
    })();
  }

  clear(): number {
    return this.db.prepare("DELETE FROM translation_cache").run().changes;
  }

  stats(): { entries: number; hits: number } {
    const r = this.db
      .prepare("SELECT COUNT(*) AS entries, COALESCE(SUM(hits),0) AS hits FROM translation_cache")
      .get() as { entries: number; hits: number };
    return r;
  }
}
