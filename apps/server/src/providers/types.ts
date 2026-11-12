import type { QuotaPeriod, QuotaUnit } from "@tg/shared";

export interface TranslateArgs {
  texts: string[];
  source: string | "auto";
  target: string;
}
export interface TranslateResult {
  translations: string[];
  charsUsed: number;
}

export interface TranslationProvider {
  id: string;
  kind: "llm" | "mt";
  maxCharsPerRequest: number;
  /** Giới hạn byte của một đoạn (mặc định = maxCharsPerRequest). */
  maxBytesPerRequest?: number;
  /** Số đoạn tối đa trong một lần gọi (mặc định không giới hạn). */
  maxItemsPerRequest?: number;
  translate(req: TranslateArgs): Promise<TranslateResult>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
}

export type ProviderErrorKind =
  | "quota" // 429 / hết hạn mức
  | "transient" // lỗi mạng, 5xx
  | "auth" // key sai
  | "invalid"; // trả về sai định dạng / lệch số phần tử

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface Credentials {
  apiKey?: string;
  accountId?: string;
  email?: string;
  baseUrl?: string;
  model?: string;
}

export interface ProviderTemplate {
  type: string;
  label: string;
  kind: "llm" | "mt";
  fields: { key: keyof Credentials; label: string; secret?: boolean; required?: boolean; placeholder?: string }[];
  defaults: { quota_unit: QuotaUnit; quota_limit: number; quota_period: QuotaPeriod; reset_timezone: string };
  keyUrl?: string;
  presets?: { name: string; credentials: Credentials; keyUrl?: string }[];
  note?: string;
}

export interface ProviderDefinition {
  template: ProviderTemplate;
  create(id: string, cred: Credentials): TranslationProvider;
}

/** fetch với timeout; chuyển lỗi HTTP thành ProviderError. */
export async function httpJson(
  url: string,
  init: RequestInit,
  timeoutMs = 20000,
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    throw new ProviderError("transient", `Lỗi mạng: ${e?.message ?? e}`);
  }
  const text = await res.text();
  if (!res.ok) {
    const msg = `HTTP ${res.status}: ${text.slice(0, 300)}`;
    if (res.status === 429) throw new ProviderError("quota", msg, 429);
    if (res.status === 401 || res.status === 403) throw new ProviderError("auth", msg, res.status);
    if (res.status >= 500) throw new ProviderError("transient", msg, res.status);
    throw new ProviderError("invalid", msg, res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("invalid", `Phản hồi không phải JSON: ${text.slice(0, 200)}`);
  }
}

/** Dùng chung cho LLM: prompt trả mảng JSON và parse kiểm tra số phần tử. */
export function llmPrompt(req: TranslateArgs): string {
  const src = req.source === "auto" ? "the source language (auto-detect)" : req.source;
  return (
    `Translate each string in the JSON array below from ${src} to ${req.target}. ` +
    `Keep the meaning, tone and any formatting/placeholders. ` +
    `Respond with ONLY a JSON array of strings with exactly ${req.texts.length} elements, in the same order.\n\n` +
    JSON.stringify(req.texts)
  );
}

export function parseLlmArray(raw: string, expected: number): string[] {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start < 0 || end < start) throw new ProviderError("invalid", "LLM không trả về mảng JSON");
  let arr: unknown;
  try {
    arr = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new ProviderError("invalid", "Không parse được mảng JSON từ LLM");
  }
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
    throw new ProviderError("invalid", "Mảng LLM trả về chứa phần tử không phải chuỗi");
  }
  if (arr.length !== expected) {
    throw new ProviderError("invalid", `LLM trả ${arr.length} phần tử, cần ${expected}`);
  }
  return arr as string[];
}
