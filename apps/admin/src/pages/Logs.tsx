import { useEffect, useState } from "react";
import { api, fmtTime } from "../api";

export function Logs() {
  const [logs, setLogs] = useState<any[]>([]);
  const load = () => api("/logs?limit=200").then((r) => setLogs(r.logs));
  useEffect(() => { load(); }, []);
  return (
    <div className="card">
      <div className="row"><h2 style={{ margin: 0 }}>Logs</h2><button className="btn sec" onClick={load}>Làm mới</button></div>
      <table>
        <thead><tr><th>Thời gian</th><th>Provider</th><th>Ký tự</th><th>Đích</th><th>Trạng thái</th><th>Chuỗi fallback</th><th>ms</th></tr></thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>{fmtTime(l.ts)}</td><td>{l.provider_id ?? "cache"}</td><td>{l.chars}</td><td>{l.target_lang}</td>
              <td><span className={`pill ${l.status === "ok" ? "ok" : "bad"}`}>{l.status}</span></td>
              <td>{l.fallback_chain.join(" → ") || "—"}</td><td>{l.latency_ms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
