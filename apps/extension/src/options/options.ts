import { loadSettings, saveSettings } from "../settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const url = $<HTMLInputElement>("url"), key = $<HTMLInputElement>("key"), target = $<HTMLInputElement>("target");
const block = $<HTMLTextAreaElement>("block"), msg = $("msg");

loadSettings().then((s) => {
  url.value = s.gatewayUrl; key.value = s.gatewayKey; target.value = s.target; block.value = s.blocklist.join("\n");
});
$("save").onclick = async () => {
  await saveSettings({
    gatewayUrl: url.value.trim(), gatewayKey: key.value.trim(), target: target.value.trim() || "vi",
    blocklist: block.value.split("\n").map((l) => l.trim()).filter(Boolean),
  });
  msg.textContent = "Đã lưu";
};
$("check").onclick = async () => {
  try {
    const r = await fetch(`${url.value.trim().replace(/\/+$/, "")}/v1/providers`, { headers: { authorization: `Bearer ${key.value.trim()}` } });
    msg.textContent = r.ok ? `OK (${(await r.json()).providers.length} provider)` : `Lỗi ${r.status}`;
  } catch (e: any) { msg.textContent = `Không kết nối được: ${e.message}`; }
};
