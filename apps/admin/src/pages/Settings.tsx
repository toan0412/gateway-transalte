import { useEffect, useState } from "react";
import { api, fmtTime } from "../api";

export function Settings() {
  const [keys, setKeys] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [th, setTh] = useState(0.9);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState("");
  const load = () => api("/keys").then((r) => setKeys(r.keys));
  useEffect(() => { load(); api("/settings").then((s) => setTh(s.safety_threshold)); }, []);
  const wrap = async (f: () => Promise<any>, ok: string) => { try { await f(); setMsg(ok); } catch (e: any) { setMsg(e.message); } };

  return (
    <>
      <div className="card">
        <h2>Gateway key</h2>
        <div className="row">
          <input placeholder="Tên (vd: chrome-extension)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={async () => { const r = await api("/keys", "POST", { name }); setFresh(r.key); setName(""); load(); }}>Tạo key</button>
        </div>
        {fresh && <p>Key mới (chỉ hiện một lần): <code>{fresh}</code></p>}
        <table>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}><td>{k.name}</td><td>{fmtTime(k.created_at)}</td>
                <td>{k.revoked_at ? <span className="pill bad">đã thu hồi</span> : <button className="btn danger" onClick={async () => { await api(`/keys/${k.id}`, "DELETE"); load(); }}>Thu hồi</button>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Ngưỡng dừng an toàn</h2>
        <div className="row">
          <input type="number" step="0.05" min="0.1" max="1" value={th} onChange={(e) => setTh(Number(e.target.value))} />
          <button className="btn" onClick={() => wrap(() => api("/settings", "PUT", { safety_threshold: th }), "Đã lưu ngưỡng")}>Lưu</button>
          <span className="muted">Dừng gọi provider khi dùng quá tỉ lệ này của hạn mức</span>
        </div>
      </div>
      <div className="card">
        <h2>Đổi mật khẩu admin</h2>
        <div className="row">
          <input type="password" placeholder="Hiện tại" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <input type="password" placeholder="Mới (≥ 8 ký tự)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          <button className="btn" onClick={() => wrap(() => api("/password", "POST", pw), "Đã đổi mật khẩu")}>Đổi</button>
        </div>
      </div>
      <div className="card">
        <h2>Cache</h2>
        <button className="btn danger" onClick={() => wrap(async () => { const r = await api("/cache", "DELETE"); setMsg(`Đã xóa ${r.deleted} mục`); }, "")}>Xóa cache</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
    </>
  );
}
