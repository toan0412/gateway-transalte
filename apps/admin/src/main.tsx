import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { Logs } from "./pages/Logs";
import { Playground } from "./pages/Playground";
import { Providers } from "./pages/Providers";
import { Settings } from "./pages/Settings";
import { Usage } from "./pages/Usage";
import "./styles.css";

const PAGES = { Providers, Playground, Usage, Logs, Settings } as const;
type PageName = keyof typeof PAGES;

function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const go = async () => {
    try { await api("/login", "POST", { password: pw }); onOk(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <main style={{ maxWidth: 360 }}>
      <div className="card">
        <h2>Translate Gateway</h2>
        <div className="row">
          <input type="password" placeholder="Mật khẩu admin" value={pw} autoFocus
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
          <button className="btn" onClick={go}>Đăng nhập</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
    </main>
  );
}

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [page, setPage] = useState<PageName>("Providers");
  useEffect(() => { api("/me").then(() => setAuthed(true), () => setAuthed(false)); }, []);
  if (authed === null) return null;
  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  const Page = PAGES[page];
  return (
    <>
      <nav>
        <b>Translate Gateway</b>
        {(Object.keys(PAGES) as PageName[]).map((p) => (
          <button key={p} className={p === page ? "on" : ""} onClick={() => setPage(p)}>{p}</button>
        ))}
        <span className="sp" />
        <button onClick={async () => { await api("/logout", "POST"); setAuthed(false); }}>Đăng xuất</button>
      </nav>
      <main><Page /></main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
