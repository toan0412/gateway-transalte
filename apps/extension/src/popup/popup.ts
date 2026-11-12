const btn = document.getElementById("page") as HTMLButtonElement;

async function tab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}
async function refresh() {
  try {
    const r = await chrome.tabs.sendMessage((await tab()).id!, { type: "page-state" });
    btn.textContent = r?.active ? "Hiện bản gốc" : "Dịch cả trang";
  } catch { btn.textContent = "Dịch cả trang"; }
}
btn.onclick = async () => {
  try {
    await chrome.tabs.sendMessage((await tab()).id!, { type: "translate-page" });
  } catch { btn.textContent = "Tải lại trang rồi thử lại"; return; }
  window.close();
};
document.getElementById("opts")!.onclick = () => chrome.runtime.openOptionsPage();
refresh();
