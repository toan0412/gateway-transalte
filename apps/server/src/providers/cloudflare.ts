import { type ProviderDefinition, ProviderError, httpJson } from "./types.js";

export const cloudflare: ProviderDefinition = {
  template: {
    type: "cloudflare",
    label: "Cloudflare Workers AI (m2m100)",
    kind: "mt",
    fields: [
      { key: "accountId", label: "Account ID", required: true },
      { key: "apiKey", label: "API token", secret: true, required: true },
    ],
    defaults: { quota_unit: "neurons", quota_limit: 10000, quota_period: "day", reset_timezone: "UTC" },
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    note: "Đơn vị neuron được ước lượng bằng số ký tự; 429 từ Cloudflare vẫn là nguồn sự thật.",
  },
  create(id, cred) {
    const self = {
      id,
      kind: "mt" as const,
      maxCharsPerRequest: 1500,
      maxBytesPerRequest: 1500,
      maxItemsPerRequest: 1,
      async translate({ texts, source, target }: { texts: string[]; source: string; target: string }) {
        if (!cred.accountId || !cred.apiKey) throw new ProviderError("auth", "Thiếu Account ID hoặc token");
        const out: string[] = [];
        for (const t of texts) {
          const body: Record<string, string> = { text: t, target_lang: target };
          if (source !== "auto") body.source_lang = source;
          else body.source_lang = "en";
          const j = await httpJson(
            `https://api.cloudflare.com/client/v4/accounts/${cred.accountId}/ai/run/@cf/meta/m2m100-1.2b`,
            {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${cred.apiKey}` },
              body: JSON.stringify(body),
            },
          );
          const txt = j.result?.translated_text;
          if (typeof txt !== "string") throw new ProviderError("invalid", "Cloudflare thiếu translated_text");
          out.push(txt);
        }
        return { translations: out, charsUsed: texts.reduce((a, t) => a + t.length, 0) };
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
