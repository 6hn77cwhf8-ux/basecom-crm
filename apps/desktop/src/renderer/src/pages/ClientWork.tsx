import { useEffect, useState } from "react";
import { DEFAULT_PROPOSAL_CHANNELS, proposalPoints, saleTypesError, SALE_KINDS, type SaleKind } from "@basecom/shared";
import { api, WORK_EVENT, type ClientWork, type DaySummary, type SearchHit, type User, type WorkKind } from "../api";
import { btn, btnDark, c, card, CopyButton, ErrorText, Field, input } from "../ui";
import { DatePicker } from "./DatePicker";
import { Modal } from "./Wallet";
import { MessageDialog } from "./MessageDialog";

/**
 * Em cliente (decisões de 16 nov 2026): trabalho de proposta ou venda num cliente concreto, com o código
 * da oportunidade na NOS (7 algarismos). O tempo não tem limite; o Chefe de Equipa recebe um alerta a cada 10 min.
 */
export const KIND_LABEL: Record<WorkKind, string> = { proposal: "Proposta", sale: "Venda" };
export const opValid = (s: string) => /^\d{7}$/.test(s.trim());
const clock = (secs: number) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 2, "0")}:${String(s).padStart(2, "0")}`;
};
const eyebrow = { fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase" as const, color: c.muted };

/** Campo da OP: só algarismos, 7. */
export function OpField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const bad = value.length > 0 && !opValid(value);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
      Código da oportunidade (OP) · obrigatório
      <input aria-label="OP" inputMode="numeric" maxLength={7} autoFocus={autoFocus} value={value} placeholder="0000000"
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 7))}
        style={{ ...input, height: 48, width: 220, fontSize: 22, fontWeight: 800, letterSpacing: ".12em", fontVariantNumeric: "tabular-nums", borderColor: bad ? "#D70015" : c.ink }} />
      <span style={{ fontSize: 12, fontWeight: 400, color: bad ? "#D70015" : c.muted }}>{bad ? "A OP tem 7 algarismos." : "7 algarismos, como no programa da NOS."}</span>
    </label>
  );
}

/** Começar trabalho em cliente sem chamada (ex.: o cliente pediu proposta por email). */
export function StartClientDialog({ onClose, onStarted, initial }: { onClose: () => void; onStarted: (d: DaySummary) => void; initial?: { id: string; name: string; nif: string } }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [co, setCo] = useState<{ id: string; name: string; nif: string } | null>(initial ?? null);
  const [kind, setKind] = useState<WorkKind>("proposal");
  const [op, setOp] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (co || q.trim().length < 3) { setHits([]); return; }
    const t = setTimeout(() => api.search(q.trim()).then((r) => setHits(r.slice(0, 6))).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, co]);
  const pill = (on: boolean) => ({ ...btn, flex: 1, height: 40, background: on ? c.ink : c.card, color: on ? c.onInk : c.ink, borderColor: on ? c.ink : c.line });
  return (
    <Modal title="Começar trabalho em cliente" onClose={onClose} width={560}>
      <span style={{ fontSize: 13, color: c.muted }}>Sem chamada: por exemplo, o cliente pediu proposta por email.</span>
      {!co ? (
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>Empresa (NIF, nome ou telefone)
          <input style={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escreva pelo menos 3 caracteres" />
          {hits.map((h) => (
            <button key={h.id} onClick={() => setCo({ id: h.id, name: h.name, nif: h.nif })} style={{ ...btn, height: "auto", padding: "8px 12px", display: "flex", justifyContent: "space-between", gap: 12, textAlign: "left", fontWeight: 600 }}>
              <span>{h.name}</span><span style={{ color: c.muted, fontWeight: 400 }}>NIF {h.nif}</span>
            </button>
          ))}
        </label>
      ) : (
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 14 }}>
          <span><b style={{ fontWeight: 600 }}>{co.name}</b> <span style={{ color: c.muted }}>· NIF {co.nif}</span></span>
          {!initial && <button style={{ ...btn, height: 30, fontSize: 12 }} onClick={() => { setCo(null); setQ(""); }}>Mudar</button>}
        </div>
      )}
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 0 6px" }}>Tipo</legend>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={pill(kind === "proposal")} aria-pressed={kind === "proposal"} onClick={() => setKind("proposal")}>Proposta</button>
          <button style={pill(kind === "sale")} aria-pressed={kind === "sale"} onClick={() => setKind("sale")}>Venda</button>
        </div>
      </fieldset>
      <OpField value={op} onChange={setOp} />
      <ErrorText>{err}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={btn} onClick={onClose}>Cancelar</button>
        <button style={btnDark} disabled={!co || !opValid(op) || busy} onClick={() => {
          setBusy(true); setErr("");
          api.startClient({ companyId: co!.id, kind, opCode: op }).then(onStarted).catch((e) => setErr(e.message)).finally(() => setBusy(false));
        }}>Começar</button>
      </div>
    </Modal>
  );
}

/** Ecrã «Em cliente» (no Ligar): nome, NIF, OP e tempo a contar, sem limite. «Terminar» volta a A trabalhar. */
export function ClientWorkCard({ me, work, onEnded, onChanged, onOpenCompany }: {
  me: User; work: ClientWork; onEnded: (d: DaySummary) => void; onChanged: (d: DaySummary) => void; onOpenCompany: (id: string) => void;
}) {
  const [, tick] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const secs = Math.max(0, Math.floor((Date.now() - new Date(work.since).getTime()) / 1000));
  const since = new Date(work.since).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const big = { margin: 0, fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" as const };
  const other: WorkKind = work.kind === "sale" ? "proposal" : "sale";
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
      <section style={{ ...card, flex: "999 1 560px", minWidth: 0, padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={eyebrow}>Em cliente · {KIND_LABEL[work.kind]}</span>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{me.name}</span>
          </div>
          <div role="timer" style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: c.muted }}>Tempo neste cliente</div>
            <div style={{ fontSize: 56, lineHeight: "60px", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{clock(secs)}</div>
            <div style={{ fontSize: 12, color: c.muted }}>sem limite</div>
          </div>
        </div>
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, borderTop: `1px solid ${c.line}`, paddingTop: 20 }}>
          <div><dt style={eyebrow}>NIF</dt><dd style={{ ...big, display: "flex", gap: 8, alignItems: "center" }}>{work.nif ?? "—"}{work.nif && <CopyButton text={work.nif} />}</dd></div>
          <div><dt style={eyebrow}>OP</dt><dd style={{ ...big, letterSpacing: ".08em", display: "flex", gap: 8, alignItems: "center" }}>{work.opCode ?? "—"}{work.opCode && <CopyButton text={work.opCode} />}</dd></div>
          <div><dt style={eyebrow}>Começou</dt><dd style={big}>{since}</dd></div>
        </dl>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{work.company}</span>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: "auto" }}>
          <button style={{ ...btnDark, height: 52, padding: "0 28px", fontSize: 15 }} disabled={busy} onClick={() => setClosing(true)}>Guardar e fechar</button>
          {work.companyId && <button style={{ ...btn, height: 52 }} onClick={() => onOpenCompany(work.companyId!)}>Abrir ficha</button>}
          {work.companyId && <button style={{ ...btn, height: 52 }} onClick={() => setMsg(true)}>Mensagem</button>}
          {work.companyId && work.opCode && <button style={{ ...btn, height: 52 }} disabled={busy} onClick={() => api.startClient({ companyId: work.companyId!, kind: other, opCode: work.opCode! }).then(onChanged).catch((e) => setErr(e.message))}>Mudar para {KIND_LABEL[other]}</button>}
        </div>
        {closing && <CloseClientDialog work={work} onClose={() => setClosing(false)} onDone={(d) => { setClosing(false); onEnded(d); }} />}
        {msg && work.companyId && <MessageDialog companyId={work.companyId} me={me} initialTemplate={work.kind === "sale" ? "docs" : "proposal"} onClose={() => setMsg(false)} />}
      </section>
      <aside style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 12 }}>
        <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 10, fontSize: 14, lineHeight: "20px" }}>
          <b style={{ fontSize: 16, fontWeight: 600 }}>Enquanto está em cliente</b>
          <span>Não é marcada nenhuma chamada. No fim, carregue em «Guardar e fechar» e preencha os dados da proposta; depois volta ao Ligar.</span>
          <span>O tempo conta como trabalho no ponto, nunca como tempo morto.</span>
        </section>
      </aside>
    </div>
  );
}

/** Faixa no topo, fora do ecrã Ligar: lembra que está em cliente e permite terminar. */
export function ClientBanner({ hidden, onOpenCompany }: { hidden: boolean; onOpenCompany: (id: string) => void }) {
  const [d, setD] = useState<DaySummary | null>(null);
  const [closing, setClosing] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const load = () => api.today().then(setD).catch(() => undefined);
    load(); const t = setInterval(load, 15_000); const k = setInterval(() => tick((x) => x + 1), 1000);
    window.addEventListener(WORK_EVENT, load);
    return () => { clearInterval(t); clearInterval(k); window.removeEventListener(WORK_EVENT, load); };
  }, []);
  const w = d?.client;
  if (hidden || !w) return null;
  const secs = Math.max(0, Math.floor((Date.now() - new Date(w.since).getTime()) / 1000));
  return (
    <div role="status" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 55, background: c.card, border: `1px solid ${c.brand}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.08)", padding: "8px 10px 8px 16px", display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
      <b style={{ fontWeight: 700 }}>Em cliente · {KIND_LABEL[w.kind]}</b>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{clock(secs)}</span>
      <span style={{ color: c.muted }}>NIF {w.nif} · OP {w.opCode}</span>
      {w.companyId && <button style={{ ...btn, height: 30, fontSize: 12 }} onClick={() => onOpenCompany(w.companyId!)}>Ficha</button>}
      <button style={{ ...btnDark, height: 30, fontSize: 12 }} onClick={() => setClosing(true)}>Guardar e fechar</button>
      {closing && <CloseClientDialog work={w} onClose={() => setClosing(false)} onDone={(x) => { setClosing(false); setD(x); }} />}
    </div>
  );
}

/** Tipos de venda (até 2: FID + XSell ou FID + Upsell; NN sozinho) com o valor de cada um (€/mês). */
export type TypesDraft = Partial<Record<SaleKind, string>>;
export const typesToNumbers = (t: TypesDraft) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Number(String(v).replace(",", ".")) || 0])) as Partial<Record<SaleKind, number>>;
export function SaleTypesPicker({ types, setTypes, walletKind = "NC" }: { types: TypesDraft; setTypes: (f: (t: TypesDraft) => TypesDraft) => void; walletKind?: "NC" | "FC" }) {
  const nums = typesToNumbers(types);
  const err = saleTypesError(nums);
  const points = err ? 0 : proposalPoints(nums, walletKind);
  return (
    <div role="group" aria-label="Tipo de venda" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Tipo de venda e valor · até 2 (FID + XSell ou FID + Upsell) · obrigatório</span>
      {SALE_KINDS.map((k) => {
        const on = types[k] !== undefined;
        const chosen = Object.keys(types) as SaleKind[];
        const blocked = !on && (chosen.length >= 2 || (k === "NN" && chosen.length > 0) || chosen.includes("NN") || (k === "XSell" && chosen.includes("Upsell")) || (k === "Upsell" && chosen.includes("XSell")) || (chosen.length === 1 && k !== "FID" && chosen[0] !== "FID"));
        const hint = k === "NN" ? "Cliente novo · sozinho" : k === "FID" ? "Renovação · mensalidade (€/mês)" : "Só o aumento da mensalidade (€/mês)";
        return (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "110px 1fr 120px", gap: 10, alignItems: "center", padding: "5px 10px", borderRadius: 10, border: `1px solid ${on ? c.ink : c.line}`, background: on ? c.surface : c.card }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, color: blocked ? c.muted : c.ink }}>
              <input type="checkbox" checked={on} disabled={blocked} onChange={(e) => setTypes((t) => { const n = { ...t }; if (e.target.checked) n[k] = ""; else delete n[k]; return n; })} /> {k}
            </label>
            <span style={{ fontSize: 12, color: c.muted }}>{hint}</span>
            {on ? <input aria-label={`Valor ${k}`} inputMode="decimal" value={types[k]} onChange={(e) => setTypes((t) => ({ ...t, [k]: e.target.value.replace(/[^0-9,.]/g, "") }))} placeholder="0,00 €" style={{ ...input, height: 34, textAlign: "right", fontWeight: 700 }} /> : <span />}
          </div>
        );
      })}
      {points > 0 && <span role="status" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px", borderRadius: 999, background: c.okSoft, fontSize: 13, fontWeight: 800 }}>+ {points.toLocaleString("pt-PT")} pontos com esta proposta</span>}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const toLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** «Guardar e fechar» (desenho 16): os dados da proposta pedem-se só no fim. Ao guardar, volta ao Ligar normalmente. */
export function CloseClientDialog({ work, onClose, onDone }: { work: ClientWork; onClose: () => void; onDone: (d: DaySummary) => void }) {
  const isProposal = work.kind !== "sale";
  const [channels, setChannels] = useState<string[]>(DEFAULT_PROPOSAL_CHANNELS);
  const [types, setTypes] = useState<TypesDraft>({});
  const [channel, setChannel] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [at, setAt] = useState("");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.catalogs().then((x) => x.catalogs.opportunities?.channels?.length && setChannels(x.catalogs.opportunities.channels)).catch(() => undefined); }, []);
  const nums = typesToNumbers(types);
  const typesErr = saleTypesError(nums);
  const ready = !typesErr && (!isProposal || (!!channel && !!at && nextAction.trim().length > 0));
  const mins = Math.max(1, Math.round((Date.now() - new Date(work.since).getTime()) / 60_000));
  const pill = (on: boolean) => ({ ...btn, height: 34, fontSize: 13, background: on ? c.ink : c.card, color: on ? c.onInk : c.ink, borderColor: on ? c.ink : c.line });
  function save() {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    api.endClient({ saleTypes: nums, channel: isProposal ? channel : undefined, nextAction: nextAction.trim() || undefined, at: at ? new Date(at).toISOString() : undefined, comment: comment.trim() || undefined })
      .then(onDone).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }
  return (
    <Modal title={`Guardar ${isProposal ? "a proposta" : "a venda"} · OP ${work.opCode ?? ""}`} onClose={onClose} width={640}>
      <span style={{ fontSize: 13, color: c.muted }}>{work.company} · em cliente há {mins} min</span>
      <SaleTypesPicker types={types} setTypes={setTypes} />
      {Object.keys(types).length > 0 && typesErr && <span style={{ fontSize: 12, color: c.muted }}>{typesErr}</span>}
      {isProposal && (
        <Field label="Canal de envio · obrigatório">
          <div role="radiogroup" aria-label="Canal de envio" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{channels.map((ch) => <button key={ch} role="radio" aria-checked={channel === ch} style={pill(channel === ch)} onClick={() => setChannel(ch)}>{ch}</button>)}</div>
        </Field>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label={`Próxima ação${isProposal ? " · obrigatório" : ""}`}><input style={{ ...input, width: 300 }} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Ex.: confirmar receção da proposta" /></Field>
        <Field label={`Data${isProposal ? " · obrigatório" : ""}`}><DatePicker withTime workdaysOnly value={at} onChange={setAt} width={240} ariaLabel="Data da próxima ação" min={toLocal(new Date()).slice(0, 10)} /></Field>
      </div>
      <Field label="Comentários"><textarea style={{ ...input, height: 60, padding: 10, resize: "vertical" }} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <ErrorText>{err}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={btn} onClick={onClose}>Cancelar</button>
        <button style={{ ...btnDark, height: 44, padding: "0 20px" }} disabled={!ready || busy} onClick={save}>{busy ? "A guardar…" : "Guardar e voltar a Ligar"}</button>
      </div>
    </Modal>
  );
}
