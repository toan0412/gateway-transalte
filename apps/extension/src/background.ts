import type { TranslateResponse, ErrorBody } from "@tg/shared";
import { loadSettings, type TranslateMsg, type TranslateReply } from "./settings";

async function translate(msg: TranslateMsg): Promise<TranslateReply> {
  const s = await loadSettings();
  if (!s.gatewayKey) return { ok: false, code: "UNAUTHORIZED", message: "Chưa cấu hình gateway key (trang Options)" };
  try {
    const res = await fetch(`${s.gatewayUrl.replace(/\/+$/, "")}/v1/translate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${s.gatewayKey}` },
      body: JSON.stringify({ texts: msg.texts, source: "auto", target: msg.target ?? s.target }),
    });
    const data = await res.json();
    if (!res.ok) {
      const e = (data as ErrorBody).error;
      return { ok: false, code: e?.code ?? "INTERNAL", message: e?.message ?? res.statusText };
    }
    return { ok: true, texts: (data as TranslateResponse).translations.map((t) => t.text) };
  } catch (e: any) {
    return { ok: false, code: "NETWORK", message: e?.message ?? "Không kết nối được gateway" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.type === "translate") {
    translate(msg).then(send);
    return true; // phản hồi bất đồng bộ
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "tg-selection", title: "Dịch đoạn đã chọn", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "tg-selection" && tab?.id) chrome.tabs.sendMessage(tab.id, { type: "translate-selection" });
});
