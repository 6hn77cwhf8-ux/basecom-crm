import { useEffect, useState } from "react";
import { formatPhone } from "@basecom/shared";
import { api, openScript, type ReceivedCall, type User } from "../api";
import { btn, btnDark, c, card, ErrorText, tone } from "../ui";
import { QuickCall } from "./QuickCall";

const when = (iso: string) => {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  return today ? t : `${d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" })} ${t}`;
};

/**
 * Chamadas recebidas (desenho 14): quem ligou para o telemóvel BASECOM, incluindo as que entraram durante outra chamada.
 * Carregar no número abre a ficha (ou mostra as empresas, se houver várias). «Devolver chamada» liga pelo telemóvel.
 */
export function Received({ me, onOpenCompany }: { me: User; onOpenCompany: (id: string) => void }) {
  const bigScript = me.role !== "admin";
  const [rows, setRows] = useState<ReceivedCall[] | null>(null);
  const [tab, setTab] = useState<"missed" | "all">("missed");
  const [open, setOpen] = useState<string | null>(null);
  const [calling, setCalling] = useState<{ co: { id: string; name: string; nif: string; walletKind?: "NC" | "FC" }; contact: { id: string; value: string }; needsKind: boolean } | null>(null);
  const [err, setErr] = useState("");
  const load = () => api.receivedCalls().then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);
  const missed = (rows ?? []).filter((r) => r.missed && !r.returned);
  const list = tab === "missed" ? missed : rows ?? [];

  async function callBack(r: ReceivedCall, co: { id: string; name: string; nif: string }) {
    setErr("");
    try {
      const d = await api.company(co.id);
      const ct = d.contacts.find((x) => x.kind === "phone" && x.value === r.number);
      if (!ct) { onOpenCompany(co.id); return; }
      // 24 nov: retribuir abre sempre o script grande no Ligar (comercial e Chefe de Equipa).
      if (bigScript) { openScript({ companyId: co.id, number: ct.value, contactId: ct.id }); return; }
      setCalling({ co: { ...co, walletKind: d.company.walletKind as "NC" | "FC" | undefined }, contact: { id: ct.id, value: ct.value }, needsKind: d.company.accountType === "client" && !d.company.ownerId && !d.company.walletKindConfirmed });
    } catch (e) { setErr((e as Error).message); }
  }
  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ height: 32, padding: "0 14px", border: 0, borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: tab === k ? 700 : 500, background: tab === k ? c.card : "transparent", color: tab === k ? c.ink : c.muted, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {label}{!!n && <span style={{ minWidth: 20, height: 20, padding: "0 6px", boxSizing: "border-box", borderRadius: 999, background: c.brand, color: "#FFFFFF", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span>}
    </button>
  );
  const grid = { display: "grid", gridTemplateColumns: "90px 140px minmax(0, 2fr) minmax(0, 1.4fr) 160px", gap: 12, alignItems: "center" } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div><span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Ligar</span><h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Chamadas recebidas</h1></div>
        <div role="tablist" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 12, background: c.sunken }}>{tabBtn("missed", "Não atendidas", missed.length)}{tabBtn("all", "Últimos 7 dias")}</div>
      </header>
      <ErrorText>{err}</ErrorText>
      <section style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ ...grid, padding: "12px 16px", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: c.muted }}><span>Hora</span><span>Número</span><span>Empresa</span><span>Estado</span><span /></div>
        {rows === null && <p style={{ padding: "0 16px 16px", color: c.muted }}>A carregar…</p>}
        {rows && list.length === 0 && <p style={{ padding: "0 16px 16px", color: c.muted }}>{tab === "missed" ? "Sem chamadas por devolver." : "Sem chamadas recebidas nos últimos 7 dias."}</p>}
        {list.map((r) => {
          const num = /^\d{9}$/.test(r.number) ? formatPhone(r.number) : r.number;
          const state = r.missed ? (r.returned ? "Não atendida · devolvida" : "Não atendida") : `Atendida${r.durationSeconds ? ` · ${Math.floor(r.durationSeconds / 60)} min ${r.durationSeconds % 60} s` : ""}`;
          const multi = r.companies.length > 1;
          return (
            <div key={r.id} style={{ borderTop: `1px solid ${c.line}`, padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ ...grid, fontSize: 13 }}>
                <b>{when(r.ringingAt)}</b>
                <button onClick={() => (r.companies.length === 1 ? onOpenCompany(r.companies[0]!.id) : multi ? setOpen(open === r.id ? null : r.id) : undefined)} disabled={!r.companies.length}
                  style={{ border: 0, background: "none", padding: 0, textAlign: "left", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: r.companies.length ? c.brand : c.ink, textDecoration: r.companies.length ? "underline" : "none", cursor: r.companies.length ? "pointer" : "default", fontVariantNumeric: "tabular-nums" }}>{num}</button>
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{multi ? `${r.companies.length} empresas com este número` : r.companies[0]?.name ?? "Número desconhecido"}</span>
                <span style={{ fontWeight: 600, color: r.missed && !r.returned ? tone.rose : r.missed ? c.muted : tone.sage }}>{state}</span>
                <span style={{ textAlign: "right" }}>{r.companies.length === 1 && r.missed && !r.returned && <button style={{ ...btnDark, height: 32, fontSize: 12 }} onClick={() => callBack(r, r.companies[0]!)}>Devolver chamada</button>}</span>
              </div>
              {multi && open === r.id && (
                <div style={{ marginLeft: 102, background: c.sunken, borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {r.companies.map((co) => (
                    <div key={co.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13 }}>
                      <span><b>{co.name}</b> <span style={{ color: c.muted }}>· NIF {co.nif}</span></span>
                      <span style={{ display: "flex", gap: 6 }}>
                        <button style={{ ...btn, height: 30, fontSize: 12 }} onClick={() => onOpenCompany(co.id)}>Abrir ficha</button>
                        {r.missed && !r.returned && <button style={{ ...btnDark, height: 30, fontSize: 12 }} onClick={() => callBack(r, co)}>Devolver</button>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
      {calling && <QuickCall company={calling.co} contact={calling.contact} needsKind={calling.needsKind} onClose={() => setCalling(null)} onSaved={() => { setCalling(null); load(); }} />}
      <span style={{ fontSize: 12, color: c.muted }}>Uma não atendida sai da lista quando liga para esse número. {me.role !== "sales" ? "Cada pessoa vê as do seu telemóvel." : ""}</span>
    </div>
  );
}
