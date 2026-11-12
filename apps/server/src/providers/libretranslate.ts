import { type ProviderDefinition, ProviderError, httpJson } from "./types.js";

export const libretranslate: ProviderDefinition = {
  template: {
    type: "libretranslate",
    label: "LibreTranslate (tự host)",
    kind: "mt",
    fields: [
      { key: "baseUrl", label: "Base URL", required: true, placeholder: "http://localhost:5000" },
      { key: "apiKey", label: "API key (nếu có)", secret: true },
    ],
    defaults: { quota_unit: "chars", quota_limit: 0, quota_period: "none", reset_timezone: "UTC" },
    note: "quota_limit = 0 nghĩa là không giới hạn.",
  },
  create(id, cred) {
    const self = {
      id,
      kind: "mt" as const,
      maxCharsPerRequest: 5000,
      maxBytesPerRequest: 5000,
      async translate({ texts, source, target }: { texts: string[]; source: string; target: string }) {
        if (!cred.baseUrl) throw new ProviderError("auth", "Thiếu baseUrl");
        const j = await httpJson(`${cred.baseUrl.replace(/\/+$/, "")}/translate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: texts, source, target, format: "text", api_key: cred.apiKey }),
        });
        const t = j.translatedText;
        if (!Array.isArray(t) || t.length !== texts.length) {
          throw new ProviderError("invalid", "LibreTranslate trả sai số phần tử");
        }
        return { translations: t as string[], charsUsed: texts.reduce((a, s) => a + s.length, 0) };
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
