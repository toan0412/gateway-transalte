import { useEffect, useState } from "react";
import { api, fmtTime } from "../api";

export function Usage() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { const f = () => api("/usage").then(setD); f(); const t = setInterval(f, 5000); return () => clearInterval(t); }, []);
  if (!d) return null;
  return (
    <>
      <h2>Usage</h2>
      <div className="grid">
        {d.providers.map((p: any) => {
          const pct = p.limit ? Math.min(100, (p.used / p.limit) * 100) : 0;
          return (
            <div className="card" key={p.id}>
              <b>{p.name}</b> {p.cooldownUntil && <span className="pill bad">tạm nghỉ</span>}
              <div className="bar"><i className={pct > 90 ? "hot" : ""} style={{ width: `${pct}%` }} /></div>
              <div>{p.used}{p.limit ? ` / ${p.limit}` : ""} {p.quota_unit} · {p.requests} request</div>
              <div className="muted">Đặt lại: {fmtTime(p.resetsAt)}</div>
            </div>
          );
        })}
      </div>
      <div className="card">
        <b>Cache</b>: {d.cache.entries} mục · {d.cache.hits} lượt hit · tỉ lệ hit {(d.cache.hitRate * 100).toFixed(1)}%
      </div>
    </>
  );
}
