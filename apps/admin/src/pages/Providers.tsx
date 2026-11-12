import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface Field { key: string; label: string; secret?: boolean; required?: boolean; placeholder?: string }
interface Template {
  type: string; label: string; fields: Field[]; keyUrl?: string; note?: string;
  defaults: { quota_unit: string; quota_limit: number; quota_period: string; reset_timezone: string };
  presets?: { name: string; credentials: Record<string, string>; keyUrl?: string }[];
}
interface Prov {
  id: string; type: string; name: string; enabled: boolean;
  quota_unit: string; quota_limit: number; quota_period: string; reset_timezone: string;
  credentials: Record<string, string>;
  status: { used: number; resetsAt: number | null; cooldownUntil: number | null };
}

function AddForm({ templates, onDone }: { templates: Template[]; onDone: () => void }) {
  const [type, setType] = useState(templates[0]?.type ?? "");
  const [preset, setPreset] = useState(-1);
  const [name, setName] = useState("");
  const [cred, setCred] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const t = templates.find((x) => x.type === type)!;
  const pr = preset >= 0 ? t.presets?.[preset] : undefined;
  const keyUrl = pr?.keyUrl ?? t.keyUrl;

  const save = async () => {
    try {
      await api("/providers", "POST", { type, name: name || pr?.name || t.label, credentials: { ...pr?.credentials, ...cred } });
      onDone();
    } catch (e: any) { setMsg(e.message); }
  };
  return (
    <div className="card">
      <h2>Thêm provider</h2>
      <div className="row">
        <label>Loại
          <select value={type} onChange={(e) => { setType(e.target.value); setPreset(-1); setCred({}); }}>
            {templates.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
          </select>
        </label>
        {t.presets && (
          <label>Mẫu
            <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
              <option value={-1}>— tùy chỉnh —</option>
              {t.presets.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label>Tên <input value={name} placeholder={pr?.name ?? t.label} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {t.fields.map((f) => (
          <label key={f.key}>{f.label}{f.required ? " *" : ""}
            <input type={f.secret ? "password" : "text"} placeholder={pr?.credentials[f.key] ?? f.placeholder}
              value={cred[f.key] ?? ""} onChange={(e) => setCred({ ...cred, [f.key]: e.target.value })} />
          </label>
        ))}
      </div>
      {keyUrl && <p className="muted">Lấy key tại <a href={keyUrl} target="_blank" rel="noreferrer">{keyUrl}</a></p>}
      {t.note && <p className="muted">{t.note}</p>}
      <div className="row"><button className="btn" onClick={save}>Lưu</button><span className="err">{msg}</span></div>
    </div>
  );
}

function Row({ p, tpl, dragProps, reload }: { p: Prov; tpl?: Template; dragProps: any; reload: () => void }) {
  const [edit, setEdit] = useState(false);
  const [cred, setCred] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(p.quota_limit);
  const [period, setPeriod] = useState(p.quota_period);
  const [unit, setUnit] = useState(p.quota_unit);
  const [tz, setTz] = useState(p.reset_timezone);
  const [test, setTest] = useState<{ ok: boolean; message?: string; latencyMs?: number } | "…" | null>(null);

  const doTest = async () => {
    setTest("…");
    try { setTest(await api(`/providers/${p.id}/test`, "POST")); } catch (e: any) { setTest({ ok: false, message: e.message }); }
  };
  const save = async () => {
    const credentials = Object.fromEntries(Object.entries(cred).filter(([, v]) => v));
    await api(`/providers/${p.id}`, "PATCH", { credentials, quota_limit: Number(limit), quota_period: period, quota_unit: unit, reset_timezone: tz });
    setEdit(false); setCred({}); reload();
  };
  const pct = p.quota_limit ? Math.min(100, (p.status.used / p.quota_limit) * 100) : 0;
  return (
    <div className="card" {...dragProps}>
      <div className="row">
        <span className="drag" title="Kéo để đổi thứ tự">⋮⋮</span>
        <b>{p.name}</b> <span className="pill">{p.type}</span>
        {p.status.cooldownUntil && <span className="pill bad">tạm nghỉ</span>}
        <span className="muted">{p.quota_limit ? `${p.status.used}/${p.quota_limit} ${p.quota_unit}/${p.quota_period}` : "không giới hạn"}</span>
        <span style={{ flex: 1 }} />
        <label style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={p.enabled} onChange={async (e) => { await api(`/providers/${p.id}`, "PATCH", { enabled: e.target.checked }); reload(); }} /> bật
        </label>
        <button className="btn sec" onClick={doTest}>Test kết nối</button>
        <button className="btn sec" onClick={() => setEdit(!edit)}>Sửa</button>
        <button className="btn danger" onClick={async () => { if (confirm(`Xóa ${p.name}?`)) { await api(`/providers/${p.id}`, "DELETE"); reload(); } }}>Xóa</button>
      </div>
      {p.quota_limit > 0 && <div className="bar"><i className={pct > 90 ? "hot" : ""} style={{ width: `${pct}%` }} /></div>}
      {test && (
        <p className={test === "…" ? "muted" : test.ok ? "good" : "err"}>
          {test === "…" ? "Đang thử…" : `${test.ok ? "OK" : "Lỗi"}: ${test.message ?? ""} ${test.latencyMs ? `(${test.latencyMs}ms)` : ""}`}
        </p>
      )}
      {edit && (
        <div style={{ marginTop: 8 }}>
          <div className="row">
            {tpl?.fields.map((f) => (
              <label key={f.key}>{f.label}
                <input type={f.secret ? "password" : "text"} placeholder={f.secret ? (p.credentials[f.key] || "chưa đặt") : ""}
                  defaultValue={f.secret ? "" : p.credentials[f.key] ?? ""} onChange={(e) => setCred({ ...cred, [f.key]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label>Hạn mức (0 = không giới hạn)<input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
            <label>Đơn vị<select value={unit} onChange={(e) => setUnit(e.target.value)}><option>chars</option><option>requests</option><option>neurons</option></select></label>
            <label>Chu kỳ<select value={period} onChange={(e) => setPeriod(e.target.value)}><option>minute</option><option>day</option><option>month</option><option>none</option></select></label>
            <label>Múi giờ đặt lại<input value={tz} onChange={(e) => setTz(e.target.value)} /></label>
            <button className="btn" onClick={save}>Lưu</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Providers() {
  const [list, setList] = useState<Prov[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reload = useCallback(async () => setList((await api("/providers")).providers), []);
  useEffect(() => { reload(); api("/templates").then((r) => setTemplates(r.templates)); }, [reload]);

  const drop = async (target: string) => {
    if (!dragId || dragId === target) return;
    const ids = list.map((p) => p.id).filter((i) => i !== dragId);
    ids.splice(ids.indexOf(target), 0, dragId);
    await api("/providers/order", "PUT", { ids });
    setDragId(null); setOverId(null); reload();
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Providers</h2><span className="muted">Thứ tự từ trên xuống = độ ưu tiên</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setAdding(!adding)}>+ Thêm provider</button>
      </div>
      {adding && templates.length > 0 && <AddForm templates={templates} onDone={() => { setAdding(false); reload(); }} />}
      {list.map((p) => (
        <Row key={p.id} p={p} tpl={templates.find((t) => t.type === p.type)} reload={reload}
          dragProps={{
            draggable: true,
            className: `card ${overId === p.id ? "over" : ""}`,
            onDragStart: () => setDragId(p.id),
            onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOverId(p.id); },
            onDragLeave: () => setOverId(null),
            onDrop: () => drop(p.id),
          }} />
      ))}
      {!list.length && <p className="muted">Chưa có provider nào.</p>}
    </>
  );
}
