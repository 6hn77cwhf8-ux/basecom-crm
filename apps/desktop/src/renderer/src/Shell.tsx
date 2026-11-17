import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtBalance } from "@basecom/shared";
import { Avatar, btn, btnDark, c, dialPref, ErrorText, font, resizePhoto, tint, tone } from "./ui";
import { IncomingBanner, PhoneDialog } from "./pages/Phone";
import { ClientBanner } from "./pages/ClientWork";
import { api, ROLE_LABEL, type Role, type MyDay, type SearchHit, type User } from "./api";
import logo from "./assets/logo-horizontal.webp";
import logoNeg from "./assets/logo-negativo.webp";
import simbolo from "./assets/simbolo.webp";
import { applyTheme, type ThemePref } from "./theme";
import { Modal } from "./pages/Wallet";

export type PageId = "painel" | "agenda" | "empresas" | "novos" | "recebidas" | "atuais" | "carteira" | "pendencias" | "tickets" | "oportunidades" | "vendas" | "equipa" | "objetivos" | "relatorios" | "config";

type NavItem = { id: PageId; label: string; d: string; roles?: Role[]; tag?: string; color?: string };
export const NAV: NavItem[] = [
  { id: "painel", label: "Painel de controlo", d: "M3 3h8v8H3zM13 3h8v5h-8zM13 11h8v10h-8zM3 14h8v7H3z", color: tone.indigo },
  { id: "agenda", label: "Agenda", d: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4", color: tone.blue },
  { id: "empresas", label: "Empresas", d: "M3 21h18M5 21V7l7-4 7 4v14M9 10h1M14 10h1M9 14h1M14 14h1M9 18h1M14 18h1", color: tone.slate },
  { id: "novos", label: "Ligar", d: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2", color: tone.sage },
  { id: "carteira", label: "C2C / Carteira", d: "M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18", color: tone.teal },
  { id: "pendencias", label: "Pendências", d: "M12 3l10 18H2zM12 10v4M12 17h.01", color: tone.sand },
  { id: "tickets", label: "Solicitações e tickets", d: "M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM14 7v12", color: tone.rose },
  { id: "oportunidades", label: "Oportunidades", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01", color: tone.orange },
  { id: "vendas", label: "Vendas e ativações", d: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6", color: tone.sage },
  { id: "equipa", label: "Equipa comercial", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 16 0v1", color: tone.blue, roles: ["admin", "team_lead"], tag: "Gestão" },
  { id: "objetivos", label: "Objetivos e comissões", d: "M5 21V4M5 4h12l-2 4 2 4H5", color: tone.plum },
  { id: "relatorios", label: "Relatórios", d: "M4 20V10M10 20V4M16 20v-7M2 20h20", color: tone.indigo, roles: ["admin", "team_lead"], tag: "Gestão" },
  { id: "config", label: "Configurações", d: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4", color: tone.slate, roles: ["admin"], tag: "Admin" },
];

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "0 0 18px", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" }}><path d={d} /></svg>
);

function readOpen() { try { return localStorage.getItem("bc_nav") !== "0"; } catch { return true; } }

export function Shell({ user, page, onNavigate, onLogout, onOpenCompany, onUser, children }: { user: User; page: PageId; onNavigate: (p: PageId) => void; onLogout: () => void; onOpenCompany: (id: string) => void; onUser?: (u: User) => void; children: ReactNode }) {
  const [looks, setLooks] = useState(false);
  const [open, setOpen] = useState(readOpen);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem("bc_nav", v ? "1" : "0"); } catch { /* sem armazenamento */ } };
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  // Números no menu (desenho 14): Agenda, Ligar (não atendidas, a laranja) e Oportunidades. Atualiza a cada 30 s.
  const [badges, setBadges] = useState<Partial<Record<PageId, number>>>({});
  useEffect(() => {
    const load = () => api.badges().then((b) => setBadges(b as Partial<Record<PageId, number>>)).catch(() => undefined);
    load(); const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [page]);

  return (
    <div style={{ display: "flex", height: "100vh", background: c.surface, color: c.ink, fontFamily: font }}>
      <nav aria-label="Navegação principal" style={{ flex: "0 0 auto", width: open ? 256 : 64, background: c.nav, borderRight: `1px solid ${c.line}`, padding: "16px 12px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: open ? "row" : "column", alignItems: "center", justifyContent: open ? "space-between" : "center", gap: open ? 0 : 10, padding: open ? "4px 0 16px 10px" : "4px 0 12px" }}>
          {!open && <img src={simbolo} alt="BASECOM" style={{ width: 26, height: "auto" }} />}
          {open ? <><img className="only-light" src={logo} alt="BASECOM" style={{ width: 132, height: "auto" }} /><img className="only-dark" src={logoNeg} alt="BASECOM" style={{ width: 132, height: "auto" }} /></> : null}
          <button onClick={toggle} aria-label={open ? "Fechar menu" : "Abrir menu"} title={open ? "Fechar menu" : "Abrir menu"} style={{ border: 0, background: "transparent", cursor: "pointer", color: c.muted, width: 32, height: 32, borderRadius: 8 }}>
            <Icon d={open ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
          </button>
        </div>
        <Bell open={open} onOpenCompany={onOpenCompany} />
        {open && <SearchBox onOpen={onOpenCompany} />}
        {items.map((n) => {
          const on = n.id === page || (n.id === "novos" && page === "recebidas");
          return (
            <button key={n.id} onClick={() => onNavigate(n.id)} title={n.label} aria-current={on ? "page" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 12px", borderRadius: 10, border: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14, textAlign: "left", color: c.ink, background: on ? tint(n.color ?? c.brand, 0.09) : "transparent", fontWeight: on ? 600 : 400, boxShadow: on ? `inset 3px 0 0 ${n.color ?? c.brand}` : "none" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, flex: "0 0 26px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: tint(n.color ?? c.muted, 0.13), color: n.color ?? c.muted, position: "relative" }}>
                <Icon d={n.d} />
                {!open && !!badges[n.id] && <span style={{ position: "absolute", top: -4, right: -4, width: 8, height: 8, borderRadius: 999, background: n.id === "novos" ? c.brand : "#8E8E93" }} />}
              </span>
              {open && <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>}
              {open && !!badges[n.id] && (
                <span role={n.id === "novos" ? "link" : undefined} title={n.id === "novos" ? "Chamadas não atendidas" : undefined}
                  onClick={n.id === "novos" ? (e) => { e.stopPropagation(); onNavigate("recebidas"); } : undefined}
                  style={{ minWidth: 20, height: 20, padding: "0 6px", boxSizing: "border-box", borderRadius: 999, background: n.id === "novos" ? c.brand : "#8E8E93", color: "#FFFFFF", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{badges[n.id]! > 99 ? "99+" : badges[n.id]}</span>
              )}
              {open && n.tag && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: n.tag === "Admin" ? "#222222" : c.surface, color: n.tag === "Admin" ? "#FFFFFF" : c.muted }}>{n.tag}</span>}
            </button>
          );
        })}
        <button onClick={onLogout} title="Terminar sessão" aria-label="Terminar sessão"
          style={{ marginTop: "auto", marginBottom: 10, height: 32, border: `1px solid ${c.line}`, borderRadius: 8, background: c.card, color: c.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />{open && "Terminar sessão"}
        </button>
        <div style={{ paddingTop: 14, borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 10 }}>
          {/* Carregar no nome abre «Aparência»: tema Claro/Escuro/Automático e a foto. */}
          <button onClick={() => setLooks(true)} title="Aparência e foto" style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flex: open ? 1 : "0 0 auto", minWidth: 0, textAlign: "left", fontFamily: "inherit", color: c.ink }}>
            <Avatar name={user.name} photo={user.photo} size={28} />
            {open && (
              <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</span>
                <span style={{ fontSize: 12, color: c.muted }}>{ROLE_LABEL[user.role]} · v{__APP_VERSION__}</span>
              </span>
            )}
          </button>
          {looks && <Appearance user={user} onClose={() => setLooks(false)} onUser={(u) => onUser?.(u)} />}
          <button onClick={() => setPhoneOpen(true)} title="Telemóvel (app BASECOM)" style={{ border: 0, background: "transparent", color: c.muted, cursor: "pointer", padding: 4 }}><Icon d="M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2" /></button>
        </div>
      </nav>
      {/* Menu recolhido: o espaço que ficava com os nomes do menu mostra «O meu dia». */}
      {!open && <MyDayPanel onAgenda={() => onNavigate("agenda")} onOpps={() => onNavigate("oportunidades")} onOpenCompany={onOpenCompany} />}
      <IncomingBanner onOpenCompany={onOpenCompany} />
      <ClientBanner hidden={page === "novos"} onOpenCompany={onOpenCompany} />
      {phoneOpen && <PhoneDialog onClose={() => setPhoneOpen(false)} />}
      <main style={{ flex: 1, minWidth: 0, padding: "24px 32px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>{children}</main>
    </div>
  );
}

/** Pesquisa global: NIF, telefone, nome, decisor ou email. Enter abre o primeiro resultado. */
function SearchBox({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => api.search(q).then((r) => { setHits(r); setSel(0); }).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setHits(null); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, []);
  const open = (id: string) => { onOpen(id); setHits(null); setQ(""); };
  return (
    <div ref={box} style={{ position: "relative", marginBottom: 10 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar NIF, nome, telefone…" aria-label="Pesquisar empresas"
        onKeyDown={(e) => {
          if (!hits?.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((sel + 1) % hits.length); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((sel - 1 + hits.length) % hits.length); }
          if (e.key === "Enter") open(hits[sel]!.id);
          if (e.key === "Escape") setHits(null);
        }}
        style={{ width: "100%", boxSizing: "border-box", height: 36, border: `1px solid ${c.line}`, borderRadius: 10, padding: "0 10px", fontSize: 13, background: c.surface }} />
      {hits && (
        <div role="listbox" style={{ position: "absolute", top: 40, left: 0, right: 0, zIndex: 40, background: c.card, border: `1px solid ${c.line}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.10)", padding: 6 }}>
          <div style={{ fontSize: 12, color: c.muted, padding: "4px 8px" }}>{hits.length ? `${hits.length === 8 ? "Primeiros 8" : hits.length} resultado${hits.length === 1 ? "" : "s"}` : "Sem resultados"}</div>
          {hits.map((h, i) => (
            <button key={h.id} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => open(h.id)}
              style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", textAlign: "left", border: 0, borderRadius: 8, padding: "8px", cursor: "pointer", background: i === sel ? c.brandSoft : "transparent", color: c.ink }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{h.name}</span>
              <span style={{ fontSize: 12, color: c.muted }}>NIF {h.nif} · {h.municipality ?? "—"} · {h.owner ?? "sem carteira"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const mins = (s: number) => `${Math.floor(s / 60)}`;
const hhmm = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" })} ${t}`;
};

/** «O meu dia»: os números de hoje e as próximas tarefas. Atualiza a cada 30 segundos. */
function MyDayPanel({ onAgenda, onOpps, onOpenCompany }: { onAgenda: () => void; onOpps: () => void; onOpenCompany: (id: string) => void }) {
  const [d, setD] = useState<MyDay | null>(null);
  useEffect(() => {
    const load = () => api.myDay().then(setD).catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const row = (k: string, v: ReactNode, warn = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${c.line}`, fontSize: 13 }}>
      <span style={{ color: c.muted }}>{k}</span><b style={{ color: warn ? c.danger : c.ink, fontVariantNumeric: "tabular-nums" }}>{v}</b>
    </div>
  );
  const lab = { fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" as const, color: c.muted };
  return (
    <aside aria-label="O meu dia" style={{ flex: "0 0 192px", background: c.card, borderRight: `1px solid ${c.line}`, padding: "20px 14px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4, overflow: "auto" }}>
      <span style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>O meu dia</span>
      {!d ? <span style={{ fontSize: 13, color: c.muted }}>A carregar…</span> : <>
        {/* Pontos do ciclo (17 nov): confirmados (Arranque B) + previsão das propostas abertas, com barra até ao escalão. */}
        {(() => {
          const p = d.points, total = p.confirmed + p.forecast, goal = p.next?.points ?? total;
          const pct = (x: number) => `${Math.min(100, goal ? (x / goal) * 100 : 100)}%`;
          return (
            <div style={{ border: `1px solid ${c.line}`, borderRadius: 12, padding: "10px 10px 8px", marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><b>Pontos do ciclo</b><span style={{ color: c.muted }}>{p.cycle}</span></span>
              <b style={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{total.toLocaleString("pt-PT")}{p.next && <span style={{ fontSize: 12, color: c.muted, fontWeight: 600 }}> / {p.next.points.toLocaleString("pt-PT")}</span>}</b>
              <div style={{ position: "relative", height: 8, borderRadius: 999, background: c.line, overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: 8, width: pct(p.confirmed), background: c.ink }} />
                <div style={{ position: "absolute", left: pct(p.confirmed), top: 0, height: 8, width: pct(p.forecast), background: c.brand }} />
              </div>
              <span style={{ fontSize: 11, color: c.muted }}>Laranja: propostas abertas (previsão)</span>
            </div>
          );
        })()}
        {/* Painel do dia (desenho 18): cada número na sua caixa com um tom suave. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
          {([["Chamadas", d.calls, tone.sage], ["Atendidas", d.effective, tone.blue], ["Propostas", d.proposals, tone.plum], ["Vendas", d.sales, tone.teal]] as const).map(([k, v, col]) => (
            <div key={k} style={{ borderRadius: 10, padding: "8px 9px", background: tint(col, 0.1), border: `1px solid ${tint(col, 0.25)}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: col }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{v}</div>
            </div>
          ))}
        </div>
        {row("Recebidas", d.incoming.received)}
        {d.incoming.toReturn > 0 && row("Por retribuir", d.incoming.toReturn, true)}
        {row("Tempo de login", `${Math.floor(d.loggedIn / 3600)} h ${String(Math.floor((d.loggedIn % 3600) / 60)).padStart(2, "0")}`)}
        {row("Saldo do dia", fmtBalance(d.ponto.balanceSeconds), d.ponto.balanceSeconds < 0 && !d.ponto.expectedExit)}
        {d.ponto.expectedExit && row("Saída prevista", new Date(d.ponto.expectedExit).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }))}
        {row("Intervalo", `${mins(d.breakUsed)} / ${mins(d.breakLimit)} min`, d.breakUsed > d.breakLimit)}
        {d.clientSeconds > 0 && row("Em cliente", `${mins(d.clientSeconds)} min`)}
        {d.officeSeconds > 0 && row("Office", `${mins(d.officeSeconds)} / ${mins(d.officeLimit)} min`)}
        {d.supportSeconds > 0 && row("Apoio", `${mins(d.supportSeconds)} min`)}
        {(d.oppsLate > 0 || d.oppsWarn > 0) && (
          <button onClick={onOpps} style={{ border: 0, marginTop: 10, background: d.oppsLate ? c.dangerSoft : c.warnSoft, color: d.oppsLate ? c.danger : c.warn, borderRadius: 8, padding: "6px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
            Oportunidades: {d.oppsLate > 0 ? `${d.oppsLate} atrasada${d.oppsLate === 1 ? "" : "s"}` : ""}{d.oppsLate > 0 && d.oppsWarn > 0 ? " · " : ""}{d.oppsWarn > 0 ? `${d.oppsWarn} em alerta` : ""} →
          </button>
        )}
        <span style={{ ...lab, marginTop: 14 }}>Agenda</span>
        {d.late > 0 && <button onClick={onAgenda} style={{ border: 0, background: c.dangerSoft, color: c.danger, borderRadius: 8, padding: "6px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>{d.late} atrasada{d.late === 1 ? "" : "s"} →</button>}
        {d.next.length === 0 && <span style={{ fontSize: 13, color: c.muted }}>Sem tarefas.</span>}
        {d.next.map((t) => (
          <button key={t.id} onClick={() => onOpenCompany(t.companyId)} style={{ border: 0, background: "transparent", padding: "5px 0", cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 12, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
            <b style={{ color: new Date(t.dueAt) < new Date() ? c.danger : c.ink }}>{hhmm(t.dueAt)}</b> {t.type}<br /><span style={{ color: c.muted }}>{t.company}</span>
          </button>
        ))}
        <button onClick={onAgenda} style={{ border: 0, background: "transparent", padding: "8px 0", cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 12, color: c.muted, textDecoration: "underline" }}>Abrir a Agenda</button>
      </>}
    </aside>
  );
}

/** Avisos (resultado fora do prazo, intervalo acima do limite…): sino com o número por ler. Atualiza a cada minuto. */
function Bell({ open, onOpenCompany }: { open: boolean; onOpenCompany: (id: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.notifications>> | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const load = () => api.notifications().then(setData).catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!data || (data.items.length === 0)) return null;
  const toggle = () => { setShow(!show); if (!show && data.unread) api.readNotifications().then(() => setData({ ...data, unread: 0 })).catch(() => undefined); };
  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      <button onClick={toggle} title="Avisos" style={{ display: "flex", alignItems: "center", gap: 10, height: 34, width: "100%", padding: "0 12px", borderRadius: 10, border: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14, background: data.unread ? c.dangerSoft : "transparent", color: data.unread ? c.danger : c.ink, fontWeight: data.unread ? 700 : 400 }}>
        <Icon d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        {open && <span style={{ flex: 1, textAlign: "left" }}>Avisos</span>}
        {data.unread > 0 && <span style={{ fontSize: 11, fontWeight: 800, minWidth: 18, height: 18, borderRadius: 9, background: "#D70015", color: "#FFF", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{data.unread}</span>}
      </button>
      {show && (
        <div style={{ position: "fixed", left: open ? 264 : 72, top: 60, width: 380, maxHeight: 480, overflow: "auto", background: c.card, border: `1px solid ${c.line}`, borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,.14)", zIndex: 40, padding: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px 10px" }}><b>Avisos</b><button onClick={() => setShow(false)} style={{ border: 0, background: "none", cursor: "pointer", color: c.muted }}>Fechar</button></div>
          {data.items.map((n) => (
            <div key={n.id} onClick={() => { if (n.companyId) { onOpenCompany(n.companyId); setShow(false); } }} style={{ padding: "8px", borderTop: `1px solid ${c.line}`, fontSize: 13, cursor: n.companyId ? "pointer" : "default", background: n.read ? "transparent" : c.brandSoft, borderRadius: 8 }}>
              <div>{n.text}</div>
              <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>{new Date(n.createdAt).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Aparência (desenho 6): tema por pessoa e foto. */
function Appearance({ user, onClose, onUser }: { user: User; onClose: () => void; onUser: (u: User) => void }) {
  const [theme, setThemeState] = useState<ThemePref>(user.theme ?? "light");
  const [err, setErr] = useState("");
  const pick = (t: ThemePref) => { setThemeState(t); applyTheme(t); api.setTheme(t).then(() => onUser({ ...user, theme: t })).catch((e) => setErr(e.message)); };
  const card = (t: ThemePref, label: string, preview: ReactNode, note?: string) => (
    <button role="radio" aria-checked={theme === t} onClick={() => pick(t)} style={{ border: theme === t ? `2px solid ${c.brand}` : `1px solid ${c.line}`, background: theme === t ? c.brandSoft : c.card, borderRadius: 14, padding: theme === t ? 9 : 10, display: "flex", flexDirection: "column", gap: 8, cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: c.ink }}>
      {preview}<b style={{ fontSize: 14 }}>{label}</b>{note && <span style={{ fontSize: 12, color: c.muted, marginTop: -4 }}>{note}</span>}
    </button>
  );
  const mini = (bg: string, side: string, bar: string, panel: string) => (
    <span aria-hidden="true" style={{ height: 72, borderRadius: 10, background: bg, display: "flex", gap: 6, padding: 8, boxSizing: "border-box", border: `1px solid ${c.line}` }}>
      <span style={{ width: 22, borderRadius: 6, background: side }} />
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}><span style={{ height: 10, width: "60%", borderRadius: 4, background: bar }} /><span style={{ flex: 1, borderRadius: 6, background: panel }} /></span>
    </span>
  );
  return (
    <Modal title="Aparência" onClose={onClose} width={600}>
      <span style={{ fontSize: 13, color: c.muted }}>Fica guardado para o seu login, em qualquer computador.</span>
      <div role="radiogroup" aria-label="Tema" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        {card("light", "Claro", mini("#F5F5F7", "#FFFFFF", "#0B0B0B", "#FFFFFF"))}
        {card("dark", "Escuro", mini("#121826", "#0E1320", "#E8ECF4", "#1B2335"))}
        {card("auto", "Automático", <span aria-hidden="true" style={{ height: 72, borderRadius: 10, overflow: "hidden", display: "flex", border: `1px solid ${c.line}` }}><span style={{ flex: 1, background: "#F5F5F7" }} /><span style={{ flex: 1, background: "#121826" }} /></span>, "Segue o Windows ou o Mac")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, borderTop: `1px solid ${c.line}`, paddingTop: 14 }}>
        <Avatar name={user.name} photo={user.photo} size={56} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <b style={{ fontSize: 14 }}>A sua foto</b>
          <span style={{ display: "flex", gap: 8 }}>
            <label style={{ ...btn, height: 34, display: "inline-flex", alignItems: "center", fontSize: 13 }}>Escolher foto
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) resizePhoto(f).then((ph) => api.setPhoto(user.id, ph).then(() => onUser({ ...user, photo: ph }))).catch((x) => setErr(x.message)); }} />
            </label>
            {user.photo && <button style={{ ...btn, height: 34, fontSize: 13 }} onClick={() => api.setPhoto(user.id, null).then(() => onUser({ ...user, photo: null })).catch((x) => setErr(x.message))}>Tirar foto</button>}
          </span>
        </div>
      </div>
      {user.role === "admin" && <DialPref />}
      <ErrorText>{err}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><button style={btnDark} onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

/** Opção pessoal do Administrador: sem telemóvel BASECOM, as chamadas saem pelo computador (Mac: FaceTime → iPhone). */
function DialPref() {
  const [on, setOn] = useState(dialPref.get());
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", borderTop: `1px solid ${c.line}`, paddingTop: 14, fontSize: 14, cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); dialPref.set(e.target.checked); }} style={{ marginTop: 3 }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><b>Ligar pelo computador</b>
        <span style={{ fontSize: 12, color: c.muted }}>Sem telemóvel BASECOM ligado, «Iniciar chamada» abre a chamada no computador (no Mac, pelo FaceTime e o iPhone). No fim, carregue em «Desligar» no CRM. Fica só neste computador.</span></span>
    </label>
  );
}
