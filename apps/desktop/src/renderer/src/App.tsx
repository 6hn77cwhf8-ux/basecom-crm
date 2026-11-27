import { useEffect, useRef, useState } from "react";
import { OPEN_SCRIPT_EVENT, PHONE_NOTICE, WORK_EVENT, api, type User } from "./api";
import { Login } from "./Login";
import { ChangePassword } from "./ChangePassword";
import { NAV, Shell, type PageId } from "./Shell";
import { Team } from "./pages/Team";
import { Settings } from "./pages/Settings";
import { Placeholder } from "./pages/Placeholder";
import { Companies } from "./pages/Companies";
import { CompanyDrawer } from "./pages/CompanyDrawer";
import { ImportWizard } from "./pages/ImportWizard";
import { PowerDialer } from "./pages/PowerDialer";
import { Received } from "./pages/Received";
import { Agenda } from "./pages/Agenda";
import { Opportunities } from "./pages/Opportunities";
import { Carteira } from "./pages/Carteira";
import { applyTheme } from "./theme";

const PHASE: Partial<Record<PageId, string>> = {
  painel: "Arranque B", atuais: "Fase 3",
  pendencias: "Arranque B", tickets: "Arranque B", vendas: "Arranque B", objetivos: "Arranque B", relatorios: "Arranque B",
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(api.hasToken());
  const [page, setPage] = useState<PageId>("novos");
  const [importing, setImporting] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    if (!api.hasToken()) return;
    api.me().then((u) => { setUser(u); if (u?.theme) applyTheme(u.theme); if (u?.role === "admin") setPage("oportunidades"); }).catch(() => undefined).finally(() => setChecking(false));
  }, []);

  // «Abrir script» numa chamada a entrar: vai para o Ligar (o Ligar abre a empresa).
  useEffect(() => {
    const h = () => { setPage("novos"); setImporting(false); };
    window.addEventListener(OPEN_SCRIPT_EVENT, h);
    return () => window.removeEventListener(OPEN_SCRIPT_EVENT, h);
  }, []);
  const logout = () => api.logout().then(() => setUser(null));
  // Sinal de vida a cada minuto: regista a entrada e mantém o ponto certo; se a aplicação fechar, o período termina no último sinal.
  // 24 nov: de 15 em 15 s, e quando o estado muda noutro lado (ex.: o responsável terminou a formação) o ecrã atualiza logo.
  const lastState = useRef<string | null | undefined>(undefined);
  const [stateNotice, setStateNotice] = useState("");
  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    const beat = () => api.heartbeat().then((r) => {
      const prev = lastState.current;
      lastState.current = r.state;
      if (prev === undefined || prev === r.state) return;
      window.dispatchEvent(new Event(WORK_EVENT));
      if (prev === "training" && r.state === "working") setStateNotice("O seu responsável terminou a formação. Já pode voltar a ligar.");
      else if (r.state === "training") setStateNotice("O seu responsável pôs-lhe a Formação.");
    }).catch(() => undefined);
    beat();
    const t = setInterval(beat, 15_000);
    const h = () => { lastState.current = undefined; beat(); };
    window.addEventListener(WORK_EVENT, h);
    return () => { clearInterval(t); window.removeEventListener(WORK_EVENT, h); };
  }, [user?.id, user?.mustChangePassword]);
  // 27 nov: «A trabalhar» parado fora do Ligar (ex.: nas Oportunidades) sem mexer: ao fim de X min volta sozinho ao Ligar.
  const pageRef = useRef(page); pageRef.current = page;
  useEffect(() => {
    if (!user || user.role === "admin") return;
    let limitMs = 3 * 60_000; let last = Date.now();
    api.catalogs().then((c) => { const m = Number(c.timeLimits.idleReturnMinutes ?? 3); limitMs = m > 0 ? m * 60_000 : 0; }).catch(() => undefined);
    const touch = () => { last = Date.now(); };
    const evs = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => {
      if (!limitMs || pageRef.current === "novos") { last = Date.now(); return; }
      if (lastState.current !== "working" || document.body.dataset.inCall === "1" || document.querySelector("[role=dialog]")) { last = Date.now(); return; }
      if (Date.now() - last >= limitMs) { last = Date.now(); setPage("novos"); setImporting(false); setCompanyId(null); setStateNotice("Estava parado fora do Ligar: voltou ao Ligar."); }
    }, 10_000);
    return () => { clearInterval(t); evs.forEach((e) => window.removeEventListener(e, touch)); };
  }, [user?.id, user?.role]);
  useEffect(() => { if (!stateNotice) return; const t = setTimeout(() => setStateNotice(""), 8000); return () => clearTimeout(t); }, [stateNotice]);
  // 27 nov (0.16.3): o telemóvel não atendeu pelo CRM — aviso vermelho (fica 12 s ou até fechar).
  const [phoneNotice, setPhoneNotice] = useState("");
  useEffect(() => { const h = (e: Event) => setPhoneNotice((e as CustomEvent<string>).detail); window.addEventListener(PHONE_NOTICE, h); return () => window.removeEventListener(PHONE_NOTICE, h); }, []);
  useEffect(() => { if (!phoneNotice) return; const t = setTimeout(() => setPhoneNotice(""), 12_000); return () => clearTimeout(t); }, [phoneNotice]);
  if (checking) return null;
  // 20 nov: o Administrador começa no Pipeline (não usa o Ligar); os outros no Ligar.
  if (!user) return <Login onDone={(u) => { setUser(u); if (u.theme) applyTheme(u.theme); setPage(u.role === "admin" ? "oportunidades" : "novos"); }} />;
  if (user.mustChangePassword) return <ChangePassword onLogout={logout} onDone={() => setUser({ ...user, mustChangePassword: false })} />;

  const label = NAV.find((n) => n.id === page)?.label ?? "";
  return (
    <Shell user={user} onUser={setUser} page={page} onNavigate={(p) => { setPage(p); setImporting(false); }} onLogout={logout} onOpenCompany={setCompanyId}>
      {page === "empresas" ? (importing && user.role === "admin"
        ? <ImportWizard onBack={() => setImporting(false)} />
        : <Companies me={user} onOpen={setCompanyId} onImport={() => setImporting(true)} />)
        : page === "novos" ? null
        : page === "recebidas" ? <Received me={user} onOpenCompany={setCompanyId} />
        : page === "agenda" ? <Agenda me={user} onOpenCompany={setCompanyId} />
        : page === "carteira" ? <Carteira me={user} onOpenCompany={setCompanyId} />
        : page === "oportunidades" ? <Opportunities me={user} onOpenCompany={setCompanyId} />
        : page === "equipa" ? <Team me={user} /> : page === "config" ? <Settings /> : <Placeholder title={label} phase={PHASE[page] ?? "Fase seguinte"} />}
      {user.role !== "admin" && <>
      {/* O Ligar fica sempre montado: ao mudar de página a chamada continua e aparece o cartão flutuante. */}
      <div style={{ display: page === "novos" ? "contents" : "none" }}>
        <PowerDialer me={user} onOpenCompany={setCompanyId} active={page === "novos"} onShow={() => { setPage("novos"); setImporting(false); }} onReceived={() => setPage("recebidas")} />
      </div>
      </>}
      {companyId && <CompanyDrawer id={companyId} me={user} onClose={() => setCompanyId(null)} />}
      {phoneNotice && <div role="alert" onClick={() => setPhoneNotice("")} style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 140, background: "#B91C1C", color: "#FFFFFF", borderRadius: 12, padding: "12px 18px", fontSize: 15, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.2)", maxWidth: "90vw", cursor: "pointer" }}>{phoneNotice}</div>}
      {stateNotice && <div role="status" style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 120, background: "#15803D", color: "#FFFFFF", borderRadius: 12, padding: "12px 18px", fontSize: 15, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.2)" }}>{stateNotice}</div>}
    </Shell>
  );
}
