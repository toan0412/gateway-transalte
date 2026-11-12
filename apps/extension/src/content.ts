import { loadSettings, type TranslateReply } from "./settings";

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA", "INPUT", "SVG"]);
const originals = new WeakMap<Text, string>();
const done = new WeakSet<Text>();
let active = false;
let observer: IntersectionObserver | null = null;
let mutation: MutationObserver | null = null;
const pending = new Map<Element, Text[]>();
let queue: Text[] = [];
let flushTimer: number | undefined;
let toastEl: HTMLElement | null = null;

// ---- gọi gateway, có fallback cục bộ bằng Translator API của Chrome
const localTranslators = new Map<string, any>();
async function localTranslate(texts: string[], target: string): Promise<string[] | null> {
  const T = (globalThis as any).Translator;
  if (!T) return null;
  try {
    let tr = localTranslators.get(target);
    if (!tr) {
      tr = await T.create({ sourceLanguage: "en", targetLanguage: target });
      localTranslators.set(target, tr);
    }
    return await Promise.all(texts.map((t) => tr.translate(t)));
  } catch {
    return null;
  }
}

async function translateBatch(texts: string[]): Promise<string[]> {
  const s = await loadSettings();
  const reply: TranslateReply = await chrome.runtime.sendMessage({ type: "translate", texts });
  if (reply.ok) return reply.texts;
  if (reply.code === "ALL_PROVIDERS_EXHAUSTED") {
    const local = await localTranslate(texts, s.target);
    if (local) {
      toast("Gateway hết quota — đang dịch bằng Translator API của Chrome");
      return local;
    }
  }
  toast(`Lỗi dịch: ${reply.message}`);
  throw new Error(reply.message);
}

function toast(msg: string) {
  toastEl?.remove();
  toastEl = document.createElement("div");
  toastEl.textContent = msg;
  Object.assign(toastEl.style, {
    position: "fixed", bottom: "16px", right: "16px", zIndex: "2147483647", background: "#222", color: "#fff",
    padding: "8px 12px", borderRadius: "6px", font: "13px system-ui", maxWidth: "320px",
  });
  document.documentElement.appendChild(toastEl);
  setTimeout(() => toastEl?.remove(), 4000);
}

// ---- dịch đoạn bôi đen
async function translateSelection() {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text || !sel?.rangeCount) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const box = document.createElement("div");
  box.textContent = "Đang dịch…";
  Object.assign(box.style, {
    position: "fixed", left: `${Math.min(rect.left, innerWidth - 340)}px`, top: `${rect.bottom + 6}px`, zIndex: "2147483647",
    background: "#fff", color: "#111", border: "1px solid #ccc", borderRadius: "6px", padding: "8px 10px",
    font: "14px/1.4 system-ui", maxWidth: "320px", boxShadow: "0 4px 14px rgba(0,0,0,.2)",
  });
  document.documentElement.appendChild(box);
  const close = (e: Event) => { if (!box.contains(e.target as Node)) { box.remove(); document.removeEventListener("mousedown", close); } };
  setTimeout(() => document.addEventListener("mousedown", close), 0);
  try { box.textContent = (await translateBatch([text]))[0]; } catch { box.remove(); }
}

// ---- dịch cả trang, chỉ phần đang hiển thị
function collectTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = (n as Text).parentElement;
      if (!p || SKIP.has(p.tagName.toUpperCase()) || p.isContentEditable) return NodeFilter.FILTER_REJECT;
      if (!/\p{L}/u.test(n.nodeValue ?? "")) return NodeFilter.FILTER_REJECT;
      return done.has(n as Text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}

function watch(nodes: Text[]) {
  for (const n of nodes) {
    const el = n.parentElement!;
    const list = pending.get(el);
    if (list) list.push(n);
    else { pending.set(el, [n]); observer!.observe(el); }
  }
}

function schedule() {
  clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, 150);
}

async function flush() {
  const nodes = queue.filter((n) => !done.has(n) && n.isConnected);
  queue = [];
  while (nodes.length && active) {
    const batch: Text[] = [];
    let chars = 0;
    while (nodes.length && batch.length < 40 && chars < 3000) {
      const n = nodes.shift()!;
      batch.push(n);
      chars += n.nodeValue!.length;
    }
    const src = batch.map((n) => n.nodeValue!);
    try {
      const out = await translateBatch(src);
      batch.forEach((n, i) => {
        if (!active || !n.isConnected) return;
        originals.set(n, n.nodeValue!);
        done.add(n);
        const lead = /^\s*/.exec(src[i])![0], trail = /\s*$/.exec(src[i])![0];
        n.nodeValue = lead + out[i].trim() + trail;
      });
    } catch {
      stopPage();
      return;
    }
  }
}

async function startPage() {
  const s = await loadSettings();
  if (s.blocklist.some((h) => location.hostname === h || location.hostname.endsWith(`.${h}`))) {
    toast("Trang này nằm trong danh sách không dịch");
    return;
  }
  active = true;
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const list = pending.get(e.target);
      if (list) { queue.push(...list); pending.delete(e.target); }
      observer!.unobserve(e.target);
    }
    if (queue.length) schedule();
  }, { rootMargin: "200px" });
  watch(collectTextNodes(document.body));
  // nội dung nạp thêm khi cuộn
  mutation = new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((a) => { if (!(a as Element).closest?.("[data-tg-ignore]")) watch(collectTextNodes(a)); });
  });
  mutation.observe(document.body, { childList: true, subtree: true });
}

function stopPage() {
  active = false;
  observer?.disconnect(); mutation?.disconnect();
  observer = mutation = null;
  pending.clear(); queue = [];
}

function restorePage() {
  stopPage();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const o = originals.get(n as Text);
    if (o !== undefined) { (n as Text).nodeValue = o; originals.delete(n as Text); done.delete(n as Text); }
  }
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.type === "translate-selection") translateSelection();
  else if (msg.type === "translate-page") {
    if (active) { restorePage(); send({ active: false }); }
    else { void startPage(); send({ active: true }); }
  }
  else if (msg.type === "page-state") send({ active });
  return false;
});
