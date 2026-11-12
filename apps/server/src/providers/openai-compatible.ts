import {
  type ProviderDefinition, ProviderError, httpJson, llmPrompt, parseLlmArray,
} from "./types.js";

export const openaiCompatible: ProviderDefinition = {
  template: {
    type: "openai-compatible",
    label: "OpenAI-compatible (Groq, OpenRouter, Mistral…)",
    kind: "llm",
    fields: [
      { key: "baseUrl", label: "Base URL", required: true, placeholder: "https://api.groq.com/openai/v1" },
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "model", label: "Model", required: true, placeholder: "llama-3.3-70b-versatile" },
    ],
    defaults: { quota_unit: "requests", quota_limit: 1000, quota_period: "day", reset_timezone: "UTC" },
    presets: [
      {
        name: "Groq",
        credentials: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
        keyUrl: "https://console.groq.com/keys",
      },
      {
        name: "OpenRouter",
        credentials: { baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free" },
        keyUrl: "https://openrouter.ai/keys",
      },
    ],
  },
  create(id, cred) {
    const self = {
      id,
      kind: "llm" as const,
      maxCharsPerRequest: 6000,
      async translate(req: { texts: string[]; source: string; target: string }) {
        if (!cred.apiKey || !cred.baseUrl || !cred.model) {
          throw new ProviderError("auth", "Thiếu baseUrl, apiKey hoặc model");
        }
        const j = await httpJson(
          `${cred.baseUrl.replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${cred.apiKey}` },
            body: JSON.stringify({
              model: cred.model,
              temperature: 0,
              messages: [
                { role: "system", content: "You are a professional translation engine." },
                { role: "user", content: llmPrompt(req) },
              ],
            }),
          },
          40000,
        );
        const text = j.choices?.[0]?.message?.content;
        if (typeof text !== "string") throw new ProviderError("invalid", "Không có nội dung trả về");
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
