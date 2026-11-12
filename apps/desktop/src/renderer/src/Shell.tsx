import { useEffect, useRef, useState, type ReactNode } from "react";
import { c, font } from "./ui";
import { api, ROLE_LABEL, type Role, type MyDay, type SearchHit, type User } from "./api";
import logo from "./assets/logo-horizontal.webp";
import simbolo from "./assets/simbolo.webp";

export type PageId = "painel" | "agenda" | "empresas" | "novos" | "atuais" | "carteira" | "pendencias" | "tickets" | "oportunidades" | "vendas" | "equipa" | "objetivos" | "relatorios" | "config";

type NavItem = { id: PageId; label: string; d: string; roles?: Role[]; tag?: string };
export const NAV: NavItem[] = [
  { id: "painel", label: "Painel de controlo", d: "M3 3h8v8H3zM13 3h8v5h-8zM13 11h8v10h-8zM3 14h8v7H3z" },
  { id: "agenda", label: "Agenda", d: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" },
  { id: "empresas", label: "Empresas", d: "M3 21h18M5 21V7l7-4 7 4v14M9 10h1M14 10h1M9 14h1M14 14h1M9 18h1M14 18h1" },
  { id: "novos", label: "Ligar", d: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" },
  { id: "carteira", label: "C2C / Carteira", d: "M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" },
  { id: "pendencias", label: "Pendências", d: "M12 3l10 18H2zM12 10v4M12 17h.01" },
  { id: "tickets", label: "Solicitações e tickets", d: "M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM14 7v12" },
  { id: "oportunidades", label: "Oportunidades", d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01" },
  { id: "vendas", label: "Vendas e ativações", d: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6" },
  { id: "equipa", label: "Equipa comercial", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 16 0v1", roles: ["admin", "team_lead"], tag: "Gestão" },
  { id: "objetivos", label: "Objetivos e comissões", d: "M5 21V4M5 4h12l-2 4 2 4H5" },
  { id: "relatorios", label: "Relatórios", d: "M4 20V10M10 20V4M16 20v-7M2 20h20", roles: ["admin", "team_lead"], tag: "Gestão" },
  { id: "config", label: "Configurações", d: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4", roles: ["admin"], tag: "Admin" },
];

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "0 0 18px", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" }}><path d={d} /></svg>
);

function readOpen() { try { return localStorage.getItem("bc_nav") !== "0"; } catch { return true; } }

export function Shell({ user, page, onNavigate, onLogout, onOpenCompany, children }: { user: User; page: PageId; onNavigate: (p: PageId) => void; onLogout: () => void; onOpenCompany: (id: string) => void; children: ReactNode }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem("bc_nav", v ? "1" : "0"); } catch { /* sem armazenamento */ } };
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  return (
    <div style={{ display: "flex", height: "100vh", background: c.surface, color: c.ink, fontFamily: font }}>
      <nav aria-label="Navegação principal" style={{ flex: "0 0 auto", width: open ? 256 : 64, background: c.card, borderRight: `1px solid ${c.line}`, padding: "16px 12px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: open ? "row" : "column", alignItems: "center", justifyContent: open ? "space-between" : "center", gap: open ? 0 : 10, padding: open ? "4px 0 16px 10px" : "4px 0 12px" }}>
          {!open && <img src={simbolo} alt="BASECOM" style={{ width: 26, height: "auto" }} />}
          {open ? <img src={logo} alt="BASECOM" style={{ width: 132, height: "auto" }} /> : null}
          <button onClick={toggle} aria-label={open ? "Fechar menu" : "Abrir menu"} title={open ? "Fechar menu" : "Abrir menu"} style={{ border: 0, background: "transparent", cursor: "pointer", color: c.muted, width: 32, height: 32, borderRadius: 8 }}>
            <Icon d={open ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
          </button>
        </div>
        {open && <SearchBox onOpen={onOpenCompany} />}
        {items.map((n) => {
          const on = n.id === page;
          return (
            <button key={n.id} onClick={() => onNavigate(n.id)} title={n.label} aria-current={on ? "page" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 12px", borderRadius: 10, border: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 14, textAlign: "left", color: c.ink, background: on ? c.brandSoft : "transparent", fontWeight: on ? 600 : 400, boxShadow: on ? `inset 3px 0 0 ${c.brand}` : "none" }}>
              <Icon d={n.d} />
              {open && <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>}
              {open && n.tag && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: n.tag === "Admin" ? "#222222" : c.surface, color: n.tag === "Admin" ? "#FFFFFF" : c.muted }}>{n.tag}</span>}
            </button>
          );
        })}
        <div style={{ marginTop: "auto", paddingTop: 14, borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: "0 0 28px", width: 28, height: 28, borderRadius: "50%", background: c.brandSoft, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{initials}</span>
          {open && (
            <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</span>
              <span style={{ fontSize: 12, color: c.muted }}>{ROLE_LABEL[user.role]} · v{__APP_VERSION__}</span>
            </span>
          )}
          {open && <button onClick={onLogout} style={{ border: 0, background: "transparent", color: c.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>Sair</button>}
        </div>
      </nav>
      {/* Menu recolhido: o espaço que ficava com os nomes do menu mostra «O meu dia». */}
      {!open && <MyDayPanel onAgenda={() => onNavigate("agenda")} onOpenCompany={onOpenCompany} />}
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
function MyDayPanel({ onAgenda, onOpenCompany }: { onAgenda: () => void; onOpenCompany: (id: string) => void }) {
  const [d, setD] = useState<MyDay | null>(null);
  useEffect(() => {
    const load = () => api.myDay().then(setD).catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const row = (k: string, v: ReactNode, warn = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${c.line}`, fontSize: 13 }}>
      <span style={{ color: c.muted }}>{k}</span><b style={{ color: warn ? "#A1000F" : c.ink, fontVariantNumeric: "tabular-nums" }}>{v}</b>
    </div>
  );
  const lab = { fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" as const, color: c.muted };
  return (
    <aside aria-label="O meu dia" style={{ flex: "0 0 192px", background: c.card, borderRight: `1px solid ${c.line}`, padding: "20px 14px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 4, overflow: "auto" }}>
      <span style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>O meu dia</span>
      {!d ? <span style={{ fontSize: 13, color: c.muted }}>A carregar…</span> : <>
        {row("N.º de chamadas", d.calls)}
        {row("Atendidas", d.effective)}
        {row("Recebidas", d.received ?? <span title="Chega com a app Android" style={{ color: c.muted, fontWeight: 400 }}>—</span>)}
        {row("Propostas", d.proposals)}
        {row("Vendas", d.sales)}
        {row("Tempo de login", `${Math.floor(d.loggedIn / 3600)} h ${String(Math.floor((d.loggedIn % 3600) / 60)).padStart(2, "0")}`)}
        {row("Intervalo", `${mins(d.breakUsed)} / ${mins(d.breakLimit)} min`, d.breakUsed > d.breakLimit)}
        <span style={{ ...lab, marginTop: 14 }}>Agenda</span>
        {d.late > 0 && <button onClick={onAgenda} style={{ border: 0, background: "#FFE5E7", color: "#A1000F", borderRadius: 8, padding: "6px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>{d.late} atrasada{d.late === 1 ? "" : "s"} →</button>}
        {d.next.length === 0 && <span style={{ fontSize: 13, color: c.muted }}>Sem tarefas.</span>}
        {d.next.map((t) => (
          <button key={t.id} onClick={() => onOpenCompany(t.companyId)} style={{ border: 0, background: "transparent", padding: "5px 0", cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 12, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
            <b style={{ color: new Date(t.dueAt) < new Date() ? "#A1000F" : c.ink }}>{hhmm(t.dueAt)}</b> {t.type}<br /><span style={{ color: c.muted }}>{t.company}</span>
          </button>
        ))}
        <button onClick={onAgenda} style={{ border: 0, background: "transparent", padding: "8px 0", cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 12, color: c.muted, textDecoration: "underline" }}>Abrir a Agenda</button>
      </>}
    </aside>
  );
}
