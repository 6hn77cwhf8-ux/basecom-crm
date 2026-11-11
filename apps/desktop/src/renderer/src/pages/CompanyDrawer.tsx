import { useEffect, useState, type ReactNode } from "react";
import { formatPhone } from "@basecom/shared";
import { api, type CompanyDetail } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, fmtDate, fmtDateTime, fmtEur } from "../ui";
import { StatusChips } from "./Companies";

type Tab = "resumo" | "contactos" | "historico" | "oportunidades" | "vendas" | "tickets";
const TABS: { id: Tab; label: string; later?: string }[] = [
  { id: "resumo", label: "Resumo" }, { id: "contactos", label: "Contactos" }, { id: "historico", label: "Histórico" },
  { id: "oportunidades", label: "Oportunidades", later: "Fase 3" }, { id: "vendas", label: "Vendas", later: "Arranque B" }, { id: "tickets", label: "Tickets e pendências", later: "Arranque B" },
];
const NOTE_KIND: Record<string, string> = { feedback: "Feedback importado", campaign: "Campanha", note: "Nota" };

/** Ficha da empresa em gaveta (maqueta «Ficha»): abre por cima do ecrã atual; «Voltar» fecha. */
export function CompanyDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<CompanyDetail | null>(null);
  const [tab, setTab] = useState<Tab>("resumo");
  const [error, setError] = useState("");

  useEffect(() => { setD(null); setTab("resumo"); api.company(id).then(setD).catch((e) => setError(e.message)); }, [id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const co = d?.company;
  const phones = d?.contacts.filter((x) => x.kind === "phone") ?? [];
  const emails = d?.contacts.filter((x) => x.kind === "email") ?? [];
  const main = phones.find((p) => p.isPrimary) ?? phones[0];
  const later = "Chega na Fase 3, com o Power Dialer e as oportunidades.";

  return (
    <div role="dialog" aria-modal="true" aria-label={co?.name ?? "Ficha da empresa"} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex" }}>
      <div onClick={onClose} style={{ flex: 1, background: "rgba(11,11,11,0.32)" }} />
      <aside style={{ width: "min(1040px, 74vw)", background: c.surface, overflow: "auto", padding: "24px 32px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 16 }}>
        <button onClick={onClose} style={{ alignSelf: "flex-start", border: 0, background: "none", cursor: "pointer", fontSize: 15, color: c.muted, padding: 0 }}>← Voltar</button>
        <ErrorText>{error}</ErrorText>
        {!co ? <p style={{ color: c.muted }}>A carregar…</p> : (
          <>
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Chip>{co.accountType === "client" ? "Cliente" : "NN"}</Chip>
                  {co.ownerId && <Chip tone={co.walletKind === "FC" ? "warn" : "neutral"}>{co.walletKind}</Chip>}
                  <StatusChips r={co} />
                </span>
                <h1 style={{ margin: 0, fontSize: 28, lineHeight: "34px", fontWeight: 800 }}>{co.name}</h1>
                <span style={{ fontSize: 14, color: c.muted }}>NIF {co.nif} · {co.municipality ?? co.locality ?? "—"} · Carteira: {co.owner ?? "sem carteira"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                <button style={btn} disabled title={later}>Nova solicitação</button>
                <button style={btn} disabled title={later}>Nova oportunidade</button>
                <button style={btnDark} disabled title={later}>Ligar</button>
              </div>
            </header>
            {co.needsReview && <Notice tone="warn">{co.needsReview}</Notice>}
            {co.doNotContact && <Notice tone="bad">Empresa marcada «Não contactar» (RGPD). Não entra em campanhas e nenhuma importação a reativa.</Notice>}

            <nav role="tablist" style={{ display: "flex", gap: 2, padding: 4, background: "#E9E9EE", borderRadius: 12, alignSelf: "flex-start" }}>
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} title={t.later ? `Chega no ${t.later}` : undefined}
                  style={{ border: 0, borderRadius: 9, padding: "7px 14px", fontSize: 14, cursor: "pointer", background: tab === t.id ? c.card : "transparent", fontWeight: tab === t.id ? 600 : 400, color: t.later && tab !== t.id ? c.muted : c.ink, boxShadow: tab === t.id ? "0 1px 2px rgba(0,0,0,.08)" : "none" }}>{t.label}</button>
              ))}
            </nav>

            {tab === "resumo" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Card title="Dados da empresa">
                  <Row k="Tipo de conta" v={co.accountType === "client" ? "Cliente NOS" : "Prospeto (NN)"} />
                  <Row k="Dimensão" v={[co.size, co.employeesBand && `${co.employeesBand} colaboradores`].filter(Boolean).join(" · ") || "—"} />
                  <Row k="Operadora atual" v={co.operator ?? "—"} />
                  <Row k="Valor L2B" v={co.l2bMonthly ? `${fmtEur(co.l2bMonthly)}/mês` : "—"} />
                  <Row k="Fim de fidelização" v={fmtDate(co.loyaltyEnd)} />
                  <Row k="Grupo económico" v={co.economicGroup ?? "—"} />
                  <Row k="Última atualização da informação" v={co.lastSourceYear ? String(co.lastSourceYear) : "—"} />
                </Card>
                <Card title="Contacto principal">
                  <Row k="Decisor" v={main?.personName ? `${main.salutation ? main.salutation + " " : ""}${main.personName}` : "—"} />
                  <Row k="Telefone" v={main ? `${formatPhone(main.value)} · ${main.phoneType === "mobile" ? "Móvel" : "Fixo"}` : "—"} />
                  <Row k="Email" v={emails[0]?.value ?? "—"} />
                  <Row k="Morada" v={co.address ?? "—"} />
                  <Row k="Código postal" v={[co.postalCode, co.locality].filter(Boolean).join(" ") || "—"} />
                </Card>
                <div style={{ gridColumn: "1 / -1" }}><Contacts d={d!} /></div>
                <div style={{ gridColumn: "1 / -1" }}><History d={d!} limit={5} onMore={() => setTab("historico")} /></div>
              </div>
            )}
            {tab === "contactos" && <Contacts d={d!} />}
            {tab === "historico" && <History d={d!} />}
            {TABS.find((t) => t.id === tab)?.later && (
              <section style={{ ...card, padding: 32, textAlign: "center", color: c.muted }}>Chega no {TABS.find((t) => t.id === tab)!.later}, tal como nas maquetas aprovadas.</section>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "bad"; children: ReactNode }) {
  return <p role="note" style={{ margin: 0, padding: "10px 14px", borderRadius: 10, fontSize: 13, background: tone === "bad" ? "#FFE5E7" : "#FFF4E5", color: tone === "bad" ? "#A1000F" : "#8A3D00" }}>{children}</p>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ ...card, padding: "16px 18px" }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 11, lineHeight: "14px", fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", borderBottom: `1px solid ${c.line}`, fontSize: 14 }}>
      <span style={{ color: c.muted }}>{k}</span><span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}

function Contacts({ d }: { d: CompanyDetail }) {
  return (
    <Card title="Contactos">
      {d.contacts.length === 0 && <p style={{ fontSize: 14, color: c.muted }}>Sem contactos.</p>}
      {d.contacts.map((x) => (
        <div key={x.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 16, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${c.line}`, fontSize: 14 }}>
          <span style={{ fontWeight: x.isPrimary ? 600 : 400 }}>{x.personName ? `${x.salutation ? x.salutation + " " : ""}${x.personName}` : <span style={{ color: c.muted }}>Contacto da empresa</span>}</span>
          <span style={{ textDecoration: x.status === "incorrect" ? "line-through" : "none" }}>
            {x.kind === "phone" ? `${formatPhone(x.value)} · ${x.phoneType === "mobile" ? "Móvel" : x.phoneType === "landline" ? "Fixo" : "Outro"}` : x.value}
            {x.isPrimary && " · principal"}
          </span>
          {x.status === "incorrect" ? <Chip tone="bad">Incorreto</Chip> : <Chip tone="ok">Válido</Chip>}
        </div>
      ))}
    </Card>
  );
}

function History({ d, limit, onMore }: { d: CompanyDetail; limit?: number; onMore?: () => void }) {
  const items = limit ? d.notes.slice(0, limit) : d.notes;
  return (
    <Card title="Histórico">
      {d.notes.length === 0 && <p style={{ fontSize: 14, color: c.muted }}>Sem histórico.</p>}
      {items.map((n) => (
        <div key={n.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: `1px solid ${c.line}`, fontSize: 14 }}>
          <span><b>{n.text}</b> <span style={{ color: c.muted }}>· {NOTE_KIND[n.kind] ?? n.kind}{n.batchId ? " (base antiga)" : n.user ? ` · ${n.user}` : ""}</span></span>
          <span style={{ color: c.muted, whiteSpace: "nowrap" }}>{n.batchId ? `importado ${fmtDate(n.at)}` : fmtDateTime(n.at)}</span>
        </div>
      ))}
      {limit && d.notes.length > limit && <button style={{ ...btn, height: 30, marginTop: 10 }} onClick={onMore}>Ver todo o histórico ({d.notes.length})</button>}
    </Card>
  );
}
