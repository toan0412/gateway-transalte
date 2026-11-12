import {
  type ProviderDefinition, ProviderError, httpJson, llmPrompt, parseLlmArray,
} from "./types.js";

export const gemini: ProviderDefinition = {
  template: {
    type: "gemini",
    label: "Gemini (AI Studio)",
    kind: "llm",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "model", label: "Model", placeholder: "gemini-2.0-flash" },
    ],
    defaults: { quota_unit: "requests", quota_limit: 200, quota_period: "day", reset_timezone: "America/Los_Angeles" },
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Hạn mức xem trong AI Studio; chỉnh lại cho khớp.",
  },
  create(id, cred) {
    const model = cred.model || "gemini-2.0-flash";
    const self = {
      id,
      kind: "llm" as const,
      maxCharsPerRequest: 8000,
      async translate(req: { texts: string[]; source: string; target: string }) {
        if (!cred.apiKey) throw new ProviderError("auth", "Thiếu API key");
        const j = await httpJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": cred.apiKey },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: llmPrompt(req) }] }],
              generationConfig: { temperature: 0, responseMimeType: "application/json" },
            }),
          },
          40000,
        );
        const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
        if (!text) throw new ProviderError("invalid", "Gemini không trả nội dung");
        const translations = parseLlmArray(text, req.texts.length);
        return { translations, charsUsed: req.texts.reduce((a, t) => a + t.length, 0) };
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
