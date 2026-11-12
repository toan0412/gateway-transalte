import { z } from "zod";

export const TranslateRequestSchema = z.object({
  texts: z.array(z.string()).min(1).max(200),
  source: z.string().min(1).default("auto"),
  target: z.string().min(1),
  provider: z.string().nullable().optional(),
  noCache: z.boolean().optional().default(false),
});
export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

export interface TranslatedItem {
  text: string;
  provider: string;
  cached: boolean;
}
export interface TranslateResponse {
  translations: TranslatedItem[];
  fallbackChain: string[];
}

export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "ALL_PROVIDERS_EXHAUSTED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INTERNAL";
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export const LANGUAGES: Record<string, string> = {
  auto: "Auto detect", en: "English", vi: "Vietnamese", zh: "Chinese", ja: "Japanese",
  ko: "Korean", fr: "French", de: "German", es: "Spanish", it: "Italian", pt: "Portuguese",
  ru: "Russian", ar: "Arabic", hi: "Hindi", th: "Thai", id: "Indonesian", tr: "Turkish",
  nl: "Dutch", pl: "Polish", uk: "Ukrainian",
};

export type QuotaUnit = "chars" | "requests" | "neurons";
export type QuotaPeriod = "minute" | "day" | "month" | "none";
