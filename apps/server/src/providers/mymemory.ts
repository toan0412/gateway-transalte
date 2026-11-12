import { type ProviderDefinition, ProviderError, httpJson } from "./types.js";

export const mymemory: ProviderDefinition = {
  template: {
    type: "mymemory",
    label: "MyMemory",
    kind: "mt",
    fields: [{ key: "email", label: "Email (nâng hạn mức lên 50.000 ký tự/ngày)", placeholder: "tuy chon" }],
    defaults: { quota_unit: "chars", quota_limit: 5000, quota_period: "day", reset_timezone: "UTC" },
    note: "Không cần key. Đặt hạn mức 50000 nếu có email.",
  },
  create(id, cred) {
    const self = {
      id,
      kind: "mt" as const,
      maxCharsPerRequest: 500,
      maxBytesPerRequest: 480,
      maxItemsPerRequest: 1,
      async translate({ texts, source, target }: { texts: string[]; source: string; target: string }) {
        const out: string[] = [];
        let chars = 0;
        for (const t of texts) {
          const u = new URL("https://api.mymemory.translated.net/get");
          u.searchParams.set("q", t);
          u.searchParams.set("langpair", `${source === "auto" ? "Autodetect" : source}|${target}`);
          if (cred.email) u.searchParams.set("de", cred.email);
          const j = await httpJson(u.toString(), {});
          const status = Number(j.responseStatus);
          if (status === 429) throw new ProviderError("quota", String(j.responseDetails), 429);
          if (status !== 200) throw new ProviderError("invalid", `MyMemory ${status}: ${j.responseDetails}`);
          const txt = j.responseData?.translatedText;
          if (typeof txt !== "string") throw new ProviderError("invalid", "MyMemory thiếu translatedText");
          if (/MYMEMORY WARNING/i.test(txt)) throw new ProviderError("quota", txt, 429);
          out.push(txt);
          chars += t.length;
        }
        return { translations: out, charsUsed: chars };
      },
      async testConnection() {
        try {
          const r = await self.translate({ texts: ["Hello"], source: "en", target: "vi" });
          return { ok: true, message: r.translations[0] };
        } catch (e: any) {
          return { ok: false, message: e.message };
        }
      },
    };
    return self;
  },
};
