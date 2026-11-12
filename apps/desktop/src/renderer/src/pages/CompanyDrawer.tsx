import { useEffect, useState, type ReactNode } from "react";
import { formatPhone } from "@basecom/shared";
import { api, type CompanyDetail, type Contact, type User } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, fmtDate, fmtDateTime, fmtEur, input } from "../ui";
import { StatusChips } from "./Companies";
import { DeleteDialog, KIND_LABEL, Modal, ReasonDialog, StatusChip, TransferDialog } from "./Wallet";

type Tab = "resumo" | "contactos" | "historico" | "oportunidades" | "vendas" | "tickets";
const TABS: { id: Tab; label: string; later?: string }[] = [
  { id: "resumo", label: "Resumo" }, { id: "contactos", label: "Contactos" }, { id: "historico", label: "Histórico" },
  { id: "oportunidades", label: "Oportunidades" }, { id: "vendas", label: "Vendas", later: "Arranque B" }, { id: "tickets", label: "Tickets e pendências", later: "Arranque B" },
];
const PORTAL: Record<string, string> = { CLIENTE: "Cliente", "EX-CLIENTE": "Ex-cliente", PROSPECT: "Prospeto" };
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtMonth = (ym: string) => { const [y, m] = ym.split("-"); return m ? `${MONTHS[Number(m) - 1]} ${y}` : ym; };
/** Famílias de produto (Lista Famílias NOS). */
const RGU_LABEL: [string, string][] = [["VM", "Voz Móvel"], ["DM", "Dados Móveis"], ["IM", "Internet Móvel"], ["VF", "Voz Fixa"], ["DF", "Dados Fixos"], ["IF", "Internet Fixa"], ["TV", "TV"], ["IT", "IT"], ["Alarmes", "Alarmes"]];

function Rgu({ rgu }: { rgu: Record<string, number> | null }) {
  if (!rgu) return <Row k="RGU" v="—" />;
  const total = Object.values(rgu).reduce((a, b) => a + b, 0);
  return (
    <div style={{ padding: "10px 0 2px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8 }}><span style={{ color: c.muted }}>RGU</span><span style={{ fontWeight: 600 }}>{total} no total</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {RGU_LABEL.map(([k, label]) => {
          const n = rgu[k] ?? 0;
          return (
            <div key={k} title={label} style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "6px 8px", background: n ? c.brandSoft : "transparent", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 12, color: n ? c.ink : c.muted }}><b>{k}</b> {label !== k ? label : ""}</span>
              <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: n ? c.ink : c.muted }}>{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const NOTE_KIND: Record<string, string> = { feedback: "Feedback importado", campaign: "Campanha", note: "Nota", wallet: "Carteira" };

/** Ficha da empresa em gaveta (maqueta «Ficha»): abre por cima do ecrã atual; «Voltar» fecha. */
export function CompanyDrawer({ id, me, onClose }: { id: string; me: User; onClose: () => void }) {
  const [d, setD] = useState<CompanyDetail | null>(null);
  const [tab, setTab] = useState<Tab>("resumo");
  const [error, setError] = useState("");

  const [dialog, setDialog] = useState<"transfer" | "kind" | "dnc" | "undnc" | "opp" | "delete" | null>(null);
  const load = () => api.company(id).then(setD).catch((e) => setError(e.message));
  useEffect(() => { setD(null); setTab("resumo"); load(); }, [id]);
  const after = () => { setDialog(null); load(); };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const co = d?.company;
  // Contacto principal: só contactos válidos (um incorreto sai logo e entra o seguinte).
  const phones = d?.contacts.filter((x) => x.kind === "phone" && x.status === "valid") ?? [];
  const emails = d?.contacts.filter((x) => x.kind === "email" && x.status === "valid") ?? [];
  const main = phones.find((p) => p.isPrimary) ?? phones[0];
  const mainEmail = emails.find((p) => p.isPrimary) ?? emails[0];
  // Decisor principal: o indicado numa chamada («Mudar de decisor») tem prioridade sobre o da importação.
  const decisor = d?.contacts.find((x) => x.kind === "person" && x.isPrimary) ?? d?.contacts.find((x) => x.isPrimary && x.personName && x.status === "valid") ?? d?.contacts.find((x) => x.personName && x.status === "valid");
  const later = "Chega na Fase 3, com o Power Dialer e as oportunidades.";
  const canEdit = !!co && (me.role === "admin" || (!!co.ownerId && co.ownerId === me.id));
  // Contactos: também quem trabalha empresas sem carteira.
  const canEditContacts = canEdit || (!!co && !co.ownerId);
  const needsKind = !!co && co.accountType === "client" && !co.ownerId && !co.walletKindConfirmed;

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
                  <StatusChips r={co} />
                </span>
                <h1 style={{ margin: 0, fontSize: 28, lineHeight: "34px", fontWeight: 800 }}>{co.name}</h1>
                <span style={{ fontSize: 14, color: c.muted }}>NIF {co.nif} · {co.municipality ?? co.locality ?? "—"} · Carteira: {co.owner ?? "sem carteira"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                <button style={btn} disabled title={later}>Nova solicitação</button>
                <button style={btn} onClick={() => setDialog("opp")}>Nova oportunidade</button>
                {main ? <a href={`tel:+351${main.value}`} style={{ ...btnDark, display: "inline-flex", alignItems: "center", textDecoration: "none" }} title="Liga pelo programa de telefone do computador; com a app Android, liga no telemóvel">Ligar {formatPhone(main.value)}</a>
                  : <button style={btnDark} disabled>Ligar</button>}
              </div>
            </header>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {me.role === "admin" && <button style={small} onClick={() => setDialog("transfer")}>Transferir carteira</button>}
              {co.ownerId && (me.role === "admin" || co.ownerId === me.id) && <button style={small} onClick={() => setDialog("kind")}>Mudar para {co.walletKind === "NC" ? "FC" : "NC"}</button>}
              {!co.doNotContact && <button style={small} onClick={() => setDialog("dnc")}>Marcar «Não contactar»</button>}
              {co.doNotContact && me.role === "admin" && <button style={small} onClick={() => setDialog("undnc")}>Retirar «Não contactar»</button>}
              {me.role === "admin" && <button style={{ ...small, color: "#A1000F" }} onClick={() => setDialog("delete")}>Apagar empresa</button>}
            </div>
            {dialog === "delete" && <DeleteDialog ids={[co.id]} label={co.name} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onClose(); }} />}
            {dialog === "opp" && <NewOpportunity companyId={co.id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setTab("oportunidades"); load(); }} />}
            {dialog === "transfer" && <TransferDialog companyIds={[co.id]} label={co.name} onClose={() => setDialog(null)} onDone={after} />}
            {dialog === "kind" && <ReasonDialog title={`Mudar a carteira para ${co.walletKind === "NC" ? "FC" : "NC"}`} confirm="Confirmar"
              text={co.walletKind === "NC" ? "Em FC, a empresa conta 50 % em tudo (pontos, valor concluído). Só por alteração manual." : "Volta a contar 100 %."}
              onClose={() => setDialog(null)} onConfirm={async (r) => { await api.setWalletKind(co.id, co.walletKind === "NC" ? "FC" : "NC", r); after(); }} />}
            {dialog === "dnc" && <ReasonDialog title="Marcar «Não contactar»" danger confirm="Marcar" text="Oposição ao contacto (RGPD). A empresa sai das campanhas e nenhuma importação a reativa. Só o Administrador pode retirar."
              onClose={() => setDialog(null)} onConfirm={async (r) => { await api.setDoNotContact(co.id, true, r); after(); }} />}
            {dialog === "undnc" && <ReasonDialog title="Retirar «Não contactar»" confirm="Retirar" text="Use só com prova de que a oposição foi retirada (fica em auditoria)."
              onClose={() => setDialog(null)} onConfirm={async (r) => { await api.setDoNotContact(co.id, false, r); after(); }} />}
            {needsKind && (
              <div role="note" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", borderRadius: 10, background: "#FFF4E5", color: "#8A3D00", fontSize: 14 }}>
                <b>Cliente NOS sem NC/FC. Identifique:</b>
                {(["NC", "FC"] as const).map((k) => <button key={k} style={{ ...small, minWidth: 56 }} onClick={() => api.identifyKind(co.id, k).then(load).catch((e) => setError(e.message))}>{k}</button>)}
                <span style={{ fontSize: 12 }}>Fica registado; depois só muda por alteração manual com justificação.</span>
              </div>
            )}
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
                  <Row k="Setor" v={co.sector ?? "—"} />
                  <Row k="Dimensão" v={[co.size, co.employeesBand && `${co.employeesBand} colaboradores`].filter(Boolean).join(" · ") || "—"} />
                  <Row k="Faturação anual" v={co.annualRevenue ? fmtEur(co.annualRevenue) : "—"} />
                  <Row k="Potencial de localizações" v={co.locationsPotential ?? "—"} />
                  <Row k="Grupo económico" v={co.economicGroup ?? "—"} />
                  {co.lastSourceYear && <Row k="Última atualização da informação" v={String(co.lastSourceYear)} />}
                </Card>
                <Card title="Contacto principal">
                  <Row k="Decisor" v={decisor?.personName ? `${decisor.salutation ? decisor.salutation + " " : ""}${decisor.personName}` : "—"} />
                  <Row k="Telefone" v={main ? <><a href={`tel:+351${main.value}`} style={link} title="Ligar">{formatPhone(main.value)}</a> · {main.phoneType === "mobile" ? "Móvel" : "Fixo"}</> : "—"} />
                  <Row k="Email" v={mainEmail ? <a href={`mailto:${mainEmail.value}`} style={link} title="Abrir no email (Outlook)">{mainEmail.value}</a> : "—"} />
                  <Row k="Morada" v={co.address ?? "—"} />
                  <Row k="Código postal" v={[co.postalCode, co.locality].filter(Boolean).join(" ") || "—"} />
                  <Row k="Concelho · Distrito" v={[co.municipality, co.district].filter(Boolean).join(" · ") || "—"} />
                </Card>
                <Card title="Serviços NOS">
                  <Row k="Operadora atual" v={co.operator ?? "—"} />
                  <Row k="Valor L2B" v={co.l2bMonthly ? `${fmtEur(co.l2bMonthly)}/mês` : "—"} />
                  <Row k="Fim de fidelização" v={fmtDate(co.loyaltyEnd)} />
                  <Row k="Meses de permanência" v={co.loyaltyMonths != null ? String(co.loyaltyMonths) : "—"} />
                  <Row k="Produto · Tecnologia" v={[co.product, co.technology].filter(Boolean).join(" · ") || "—"} />
                  <Rgu rgu={co.rgu} />
                </Card>
                <Card title="Portal NOS">
                  <Row k="Estado no portal" v={co.portalStatus ? <Chip tone={co.portalStatus === "CLIENTE" ? "ok" : co.portalStatus === "EX-CLIENTE" ? "warn" : "neutral"}>{PORTAL[co.portalStatus] ?? co.portalStatus}</Chip> : "—"} />
                  <Row k="Saída da NOS" v={co.nosExitMonth ? fmtMonth(co.nosExitMonth) : "—"} />
                  <Nbo value={co.nboCampaign} />
                </Card>
                <div style={{ gridColumn: "1 / -1" }}><Contacts d={d!} canEdit={canEditContacts} onChange={load} /></div>
                <div style={{ gridColumn: "1 / -1" }}><History d={d!} limit={5} onMore={() => setTab("historico")} /></div>
              </div>
            )}
            {tab === "contactos" && <Contacts d={d!} canEdit={canEditContacts} onChange={load} />}
            {tab === "oportunidades" && <CompanyOpps id={co.id} />}
            {tab === "historico" && <><WalletHistory d={d!} /><History d={d!} /></>}
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

const small = { ...btn, height: 30, fontSize: 12 };
const link = { color: c.ink, textDecoration: "underline", textDecorationColor: c.brand, textUnderlineOffset: 3, fontWeight: 600 } as const;

function WalletHistory({ d }: { d: CompanyDetail }) {
  if (!d.wallet.length) return null;
  return (
    <Card title="Histórico de carteira">
      {d.wallet.map((w) => (
        <div key={w.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: `1px solid ${c.line}`, fontSize: 14 }}>
          <span><b>{KIND_LABEL[w.kind] ?? w.kind}</b> → {w.toOwner ?? "sem carteira"} <span style={{ color: c.muted }}>· {w.reason}</span></span>
          <span style={{ display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}><span style={{ color: c.muted }}>desde {fmtDate(w.effectiveFrom)}</span><StatusChip s={w.status} /></span>
        </div>
      ))}
    </Card>
  );
}

function Contacts({ d, canEdit, onChange }: { d: CompanyDetail; canEdit: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [showBad, setShowBad] = useState(false);
  const good = d.contacts.filter((x) => x.status !== "incorrect");
  const bad = d.contacts.filter((x) => x.status === "incorrect");
  const row = (x: Contact) => (
    <div key={x.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 16, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${c.line}`, fontSize: 14 }}>
      <span style={{ fontWeight: x.isPrimary ? 600 : 400 }}>{x.personName ? `${x.salutation ? x.salutation + " " : ""}${x.personName}` : <span style={{ color: c.muted }}>Contacto da empresa</span>}</span>
      <span style={{ textDecoration: x.status === "incorrect" ? "line-through" : "none" }}>
        {x.kind === "phone" ? <>{x.status === "incorrect" ? formatPhone(x.value) : <a href={`tel:+351${x.value}`} style={link}>{formatPhone(x.value)}</a>} · {x.phoneType === "mobile" ? "Móvel" : x.phoneType === "landline" ? "Fixo" : "Outro"}</>
          : x.kind === "person" ? <span style={{ color: c.muted }}>Sem telefone nem email</span>
          : x.status === "incorrect" ? x.value : <a href={`mailto:${x.value}`} style={link}>{x.value}</a>}
        {x.isPrimary && x.status !== "incorrect" && " · principal"}
      </span>
      {x.kind === "person" ? <Chip tone={x.isPrimary ? "brand" : "neutral"}>{x.isPrimary ? "Decisor principal" : "2.º decisor"}</Chip> : x.status === "incorrect" ? <Chip tone="bad">Incorreto</Chip> : <Chip tone="ok">Válido</Chip>}
      {canEdit && x.kind !== "person" ? <button style={{ ...small, height: 26 }} onClick={() => api.setContactStatus(x.id, x.status === "incorrect" ? "valid" : "incorrect").then(onChange)}>{x.status === "incorrect" ? "Marcar válido" : "Marcar incorreto"}</button> : <span />}
    </div>
  );
  return (
    <section style={{ ...card, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 11, lineHeight: "14px", fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Contactos</h2>
        {canEdit && !adding && <button style={small} onClick={() => setAdding(true)}>+ Acrescentar contacto</button>}
      </div>
      {adding && <AddContact companyId={d.company.id} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChange(); }} />}
      {good.length === 0 && <p style={{ fontSize: 14, color: c.muted }}>Sem contactos válidos.</p>}
      {good.map(row)}
      {bad.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontSize: 13, color: c.muted }} onClick={() => setShowBad(!showBad)}>{showBad ? "▾" : "▸"} Incorretos ({bad.length})</button>
          {showBad && bad.map(row)}
        </div>
      )}
    </section>
  );
}

function AddContact({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"phone" | "email">("phone");
  const [value, setValue] = useState("");
  const [salutation, setSalutation] = useState("");
  const [personName, setPersonName] = useState("");
  const [primary, setPrimary] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = () => {
    setBusy(true); setErr("");
    api.addContact(companyId, { kind, value, personName: personName || undefined, salutation: salutation || undefined, primary }).then(onDone).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };
  const f = { ...input, height: 34 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, margin: "6px 0 10px", border: `1px solid ${c.line}`, borderRadius: 12, background: c.surface }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ ...f, width: 120 }} value={kind} onChange={(e) => setKind(e.target.value as "phone" | "email")}><option value="phone">Telefone</option><option value="email">Email</option></select>
        <input style={{ ...f, width: 220 }} autoFocus placeholder={kind === "phone" ? "912 345 678" : "nome@empresa.pt"} value={value} onChange={(e) => setValue(e.target.value)} />
        <select style={{ ...f, width: 90 }} value={salutation} onChange={(e) => setSalutation(e.target.value)}><option value="">—</option><option>Sr.</option><option>Srª</option><option>Dr.</option><option>Drª</option><option>Eng.</option><option>Engª</option></select>
        <input style={{ ...f, width: 220 }} placeholder="Nome da pessoa (opcional)" value={personName} onChange={(e) => setPersonName(e.target.value)} />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} /> Principal</label>
      </div>
      <ErrorText>{err}</ErrorText>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={small} onClick={onClose}>Cancelar</button>
        <button style={{ ...btnDark, height: 30, fontSize: 12 }} disabled={busy || value.trim().length < 3} onClick={save}>Guardar contacto</button>
      </div>
    </div>
  );
}

/** Campanha NBO da NOS: «SOMA | Adicionar fixo — oferta 1 | oferta 2 …» mostrada organizada. */
function Nbo({ value }: { value: string | null }) {
  if (!value) return <Row k="Campanha NBO" v="—" />;
  const [head, rest] = value.includes(" — ") ? [value.slice(0, value.indexOf(" — ")), value.slice(value.indexOf(" — ") + 3)] : ["", value];
  const [campaign, ...type] = head.split("|").map((x) => x.trim());
  const offers = rest.split("|").map((x) => x.trim()).filter(Boolean);
  return (
    <div style={{ padding: "8px 0", fontSize: 14 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ color: c.muted }}>Campanha NBO</span>
        {campaign && <Chip tone="brand">{campaign}</Chip>}
        {type.length > 0 && <Chip>{type.join(" · ")}</Chip>}
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
        {offers.map((o, i) => <li key={i} style={{ lineHeight: "20px" }}>{o}</li>)}
      </ol>
    </div>
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

function CompanyOpps({ id }: { id: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.companyOpportunities>> | null>(null);
  useEffect(() => { api.companyOpportunities(id).then(setRows).catch(() => setRows([])); }, [id]);
  return (
    <Card title="Oportunidades">
      {rows?.length === 0 && <p style={{ fontSize: 14, color: c.muted }}>Sem oportunidades. Crie com «Nova oportunidade» ou pelo resultado «Proposta» de uma chamada.</p>}
      {rows?.map((o) => (
        <div key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: `1px solid ${c.line}`, fontSize: 14 }}>
          <span><Chip tone={o.stage === "won" ? "ok" : o.stage === "lost" ? "bad" : "brand"}>{o.stageLabel}</Chip> <span style={{ color: c.muted }}>{o.services ?? ""}</span></span>
          <span style={{ color: c.muted }}>criada {fmtDate(o.createdAt)}{o.closedAt ? ` · fechada ${fmtDate(o.closedAt)}` : ` · última atividade ${fmtDate(o.lastActivityAt)}`}</span>
        </div>
      ))}
    </Card>
  );
}

function NewOpportunity({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const [stage, setStage] = useState("interest");
  const [services, setServices] = useState("");
  const [err, setErr] = useState("");
  const stages = [["interest", "Interesse"], ["survey", "Levantamento"], ["proposal", "Proposta enviada"], ["negotiation", "Em negociação"], ["documents", "Aguarda documentos"]];
  return (
    <Modal title="Nova oportunidade" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{stages.map(([id, l]) => <button key={id} onClick={() => setStage(id!)} style={{ ...btn, height: 32, fontSize: 13, background: stage === id ? c.ink : c.card, color: stage === id ? "#FFF" : c.ink }}>{l}</button>)}</div>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>Serviços<input style={input} value={services} onChange={(e) => setServices(e.target.value)} placeholder="Ex.: 4 linhas móveis + internet fixa" /></label>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={btnDark} onClick={() => api.createOpportunity({ companyId, stage, services: services || undefined }).then(onDone).catch((e) => setErr(e.message))}>Criar</button>
        </div>
      </div>
    </Modal>
  );
}
