export interface Settings {
  gatewayUrl: string;
  gatewayKey: string;
  target: string;
  blocklist: string[];
}
export const DEFAULTS: Settings = {
  gatewayUrl: "http://localhost:8787",
  gatewayKey: "",
  target: "vi",
  blocklist: [],
};
export async function loadSettings(): Promise<Settings> {
  const s = (await chrome.storage.local.get({ ...DEFAULTS })) as unknown as Partial<Settings>;
  return { ...DEFAULTS, ...s } as Settings;
}
export const saveSettings = (s: Partial<Settings>) => chrome.storage.local.set(s);

export interface TranslateMsg { type: "translate"; texts: string[]; target?: string }
export type TranslateReply =
  | { ok: true; texts: string[] }
  | { ok: false; code: string; message: string };
