import { useEffect, useState } from "react";
import { LANGUAGES } from "@tg/shared";
import { api } from "../api";

export function Playground() {
  const [text, setText] = useState("Hello world");
  const [source, setSource] = useState("auto");
  const [target, setTarget] = useState("vi");
  const [provider, setProvider] = useState("");
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api("/providers").then((r) => setProviders(r.providers)); }, []);

  const run = async () => {
    setErr(""); setOut(null);
    try { setOut(await api("/playground", "POST", { text, source, target, provider: provider || null })); }
    catch (e: any) { setErr(`${e.code}: ${e.message}`); }
  };
  const langs = Object.entries(LANGUAGES);
  return (
    <div className="card">
      <h2>Playground</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ margin: "8px 0" }}>
        <label>Từ<select value={source} onChange={(e) => setSource(e.target.value)}>{langs.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Sang<select value={target} onChange={(e) => setTarget(e.target.value)}>{langs.filter(([k]) => k !== "auto").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Provider<select value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">Tự động</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="btn" onClick={run}>Dịch</button>
      </div>
      {err && <p className="err">{err}</p>}
      {out && (
        <>
          <div className="card" style={{ background: "var(--bg)" }}>{out.translations[0].text}</div>
          <p className="muted">Provider: <b>{out.translations[0].provider}</b> · {out.latencyMs}ms · chuỗi: {out.fallbackChain.join(" → ")}</p>
        </>
      )}
    </div>
  );
}
