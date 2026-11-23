import { useEffect, useState } from "react";
import { cycleForDate, OPPORTUNITY_STAGES, operatorRefusalNote } from "@basecom/shared";
import { type PipelineAgg, type PipelineStats, api, type Catalogs, type Opportunity, type Reason, type User } from "../api";
import { Avatar, btn, btnDark, c, card, Chip, CopyButton, ErrorText, Field, fmtDate, fmtEur, fmtInt, input, PageHeader } from "../ui";
import { Modal } from "./Wallet";
import { DatePicker } from "./DatePicker";
import { SaleTypesPicker, typesToNumbers, type TypesDraft } from "./ClientWork";
import { saleTypesError } from "@basecom/shared";

const OPEN = OPPORTUNITY_STAGES.filter((s) => s.open);

/** Cores das etapas (desenho do Pipeline, 16–17 nov): cabeçalho, texto do cabeçalho e barra dos cartões. */
const STAGE_COLOR: Record<string, { bg: string; ink: string; bar: string }> = {
  interest: { bg: "#2563EB", ink: "#FFFFFF", bar: "#60A5FA" },
  survey: { bg: "#FF5A00", ink: "#0B0B0B", bar: "#FF8A4C" },
  proposal: { bg: "#15803D", ink: "#FFFFFF", bar: "#4ADE80" },
  negotiation: { bg: "#0369A1", ink: "#FFFFFF", bar: "#38BDF8" },
  documents: { bg: "#7C3AED", ink: "#FFFFFF", bar: "#A78BFA" },
};
const eur = (n: number) => fmtEur(n);
const value = (o: Opportunity) => Number(o.proposedValue ?? 0);

/**
 * Pipeline (Oportunidades): cinco etapas com cores, valor proposto por coluna, cartões com OP, estado da regra dos
 * sete dias, barra dos dias sem atividade e a foto do comercial. Administrador e Chefe de Equipa têm também a vista
 * «Por comercial». A regra dos sete dias: alerta ao 5.º dia, atrasada ao 7.º (configurável); nunca fecha sozinha.
 */
export function Opportunities({ me, onOpenCompany }: { me: User; onOpenCompany: (id: string) => void }) {
  // Administrador: todos; Chefe de Equipa: a sua equipa (o servidor limita).
  const isAdmin = me.role !== "sales";
  const [rows, setRows] = useState<Opportunity[] | null>(null);
  const [wonCycle, setWonCycle] = useState(0);
  const [closed, setClosed] = useState(false);
  const [view, setView] = useState<"stage" | "person">("stage");
  const [owner, setOwner] = useState("");
  const [people, setPeople] = useState<{ id: string; name: string; role: string; photo: string | null }[]>([]);
  const [cat, setCat] = useState<Catalogs | null>(null);
  const [dialog, setDialog] = useState<{ kind: "activity" | "lose" | "move" | "win"; o: Opportunity; stage?: string } | null>(null);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const load = () => {
    api.opportunities({ ownerId: owner || undefined, closed }).then(setRows).catch((e) => setError(e.message));
    if (!closed) api.opportunities({ ownerId: owner || undefined, closed: true }).then((l) => {
      const cyc = cycleForDate(new Date());
      setWonCycle(l.filter((o) => o.stage === "won" && o.closedAt && new Date(o.closedAt) >= cyc.start).length);
    }).catch(() => undefined);
  };
  useEffect(() => { load(); }, [owner, closed]);
  useEffect(() => { api.catalogs().then(setCat).catch(() => undefined); if (isAdmin) api.agendaPeople().then(setPeople).catch(() => undefined); }, []);

  const late = rows?.filter((o) => o.alert?.level === "late").length ?? 0;
  const warn = rows?.filter((o) => o.alert?.level === "warn").length ?? 0;
  const total = (rows ?? []).reduce((a, o) => a + value(o), 0);
  const photoOf = (id: string) => people.find((p) => p.id === id)?.photo ?? null;
  const cardProps = (o: Opportunity) => ({
    o, photo: o.ownerPhoto ?? photoOf(o.ownerId), showOwner: isAdmin, onDrag: (on: boolean) => setDragId(on ? o.id : null), dragging: dragId === o.id,
    onOpen: () => onOpenCompany(o.companyId), onAction: (kind: "activity" | "lose" | "move") => setDialog({ kind, o }),
    onWin: () => setDialog({ kind: "win", o }),
  });
  const pill = (on: boolean) => ({ border: 0, height: 32, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: on ? 700 : 600, background: on ? c.ink : "transparent", color: on ? c.onInk : c.muted });

  return (
    <>
      <PageHeader eyebrow="Pipeline" title="Oportunidades" actions={<>
        {isAdmin && view === "stage" && <select aria-label="Comercial" style={{ ...input, height: 38, width: 200 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Todos os comerciais</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {isAdmin && !closed && (
          <div role="group" aria-label="Vista" style={{ display: "flex", padding: 3, borderRadius: 999, background: c.card, border: `1px solid ${c.line}` }}>
            <button style={pill(view === "stage")} onClick={() => setView("stage")}>Por etapa</button>
            <button style={pill(view === "person")} onClick={() => { setView("person"); setOwner(""); }}>Por comercial</button>
          </div>
        )}
        <button style={btn} onClick={() => setClosed(!closed)}>{closed ? "Ver em curso" : "Ver fechadas (90 dias)"}</button>
      </>} />
      {!closed && <PipelineNumbers me={me} key={String(rows?.length ?? 0) + owner} />}
      <ErrorText>{error}</ErrorText>
      {closed ? (
        <section style={{ ...card, overflow: "hidden" }}>
          {rows?.length === 0 && <p style={{ padding: 24, color: c.muted, margin: 0 }}>Sem oportunidades fechadas nos últimos 90 dias.</p>}
          {rows?.map((o) => (
            <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 16, padding: "10px 16px", borderBottom: `1px solid ${c.line}`, fontSize: 14, alignItems: "center" }}>
              <button onClick={() => onOpenCompany(o.companyId)} style={link}>{o.company}</button>
              <Chip tone={o.stage === "won" ? "ok" : "bad"}>{o.stageLabel}{o.stage === "lost" && o.lostReasonId ? ` · ${cat?.catalogs.reasons.find((r) => r.id === o.lostReasonId)?.label ?? ""}` : ""}</Chip>
              <span style={{ color: c.muted }}>{o.closedAt ? fmtDate(o.closedAt) : ""}{isAdmin ? ` · ${o.owner}` : ""}</span>
            </div>
          ))}
        </section>
      ) : view === "person" && isAdmin ? (
        <PorComercial rows={rows ?? []} people={people.filter((p) => p.role !== "admin" || (rows ?? []).some((o) => o.ownerId === p.id))} onOpen={onOpenCompany} />
      ) : (
        <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${OPEN.length}, minmax(190px, 1fr))`, gap: 10, alignItems: "start", minWidth: 1000 }}>
          {OPEN.map((s) => {
            const list = rows?.filter((o) => o.stage === s.id) ?? [];
            const col = STAGE_COLOR[s.id]!;
            return (
              <section key={s.id}
                // Arrastar um cartão para outra etapa muda a etapa (fica no histórico como «Mudar etapa»).
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOver(s.id); } }}
                onDragLeave={() => setOver((x) => (x === s.id ? null : x))}
                onDrop={(e) => {
                  e.preventDefault(); setOver(null);
                  const o = rows?.find((x) => x.id === dragId); setDragId(null);
                  if (!o || o.stage === s.id) return;
                  // 23 nov: sem OP não passa para Proposta enviada ou seguintes — pede-a primeiro.
                  if (NEEDS_OP.includes(s.id) && !o.nosOp) { setDialog({ kind: "move", o, stage: s.id }); return; }
                  setRows((r) => r?.map((x) => (x.id === o.id ? { ...x, stage: s.id, stageLabel: s.label } : x)) ?? r);
                  api.moveOpportunity(o.id, s.id).then(load).catch((err) => { setError(err.message); load(); });
                }}
                style={{ borderRadius: 14, padding: over === s.id ? 6 : 0, outline: over === s.id ? `2px dashed ${col.bg}` : "none", display: "flex", flexDirection: "column", gap: 10, minHeight: 160, transition: "padding .15s" }}>
                <div style={{ height: 48, borderRadius: 12, padding: "0 12px 0 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: col.bg, color: col.ink }}>
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}><b style={{ fontSize: 15, fontWeight: 800 }}>{s.label}</b><span style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>{eur(list.reduce((a, o) => a + value(o), 0))}/mês</span></span>
                  <span style={{ minWidth: 28, height: 24, borderRadius: 999, background: "rgba(0,0,0,.22)", color: "#FFFFFF", fontSize: 12, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 8px" }}>{list.length}</span>
                </div>
                {list.map((o) => <OppCard key={o.id} {...cardProps(o)} bar={col.bar} />)}
              </section>
            );
          })}
        </div>
        </div>
      )}
      {dialog?.kind === "activity" && <Activity o={dialog.o} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.kind === "win" && <Win o={dialog.o} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.kind === "move" && <Move o={dialog.o} initial={dialog.stage} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.kind === "lose" && cat && <Lose o={dialog.o} reasons={cat.catalogs.reasons.filter((r) => r.active)} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </>
  );
}

const link = { border: 0, background: "none", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: 14, color: c.ink, textAlign: "left" as const, fontFamily: "inherit" };
const small = { ...btn, height: 28, fontSize: 12, padding: "0 8px" };
const statusPill = (lvl: string) => (lvl === "late" ? { label: "Atrasada", bg: c.dangerSoft, ink: c.danger } : lvl === "warn" ? { label: "Alerta", bg: c.warnSoft, ink: c.warn } : { label: "Em dia", bg: c.okSoft, ink: c.ok });

function OppCard({ o, photo, bar, showOwner, onOpen, onAction, onWin, onDrag, dragging }: { o: Opportunity; photo: string | null; bar: string; showOwner: boolean; onDrag: (on: boolean) => void; dragging: boolean; onOpen: () => void; onAction: (k: "activity" | "lose" | "move") => void; onWin: () => void }) {
  const lvl = o.alert?.level ?? "ok";
  const st = statusPill(lvl);
  const days = o.alert?.days ?? 0;
  return (
    <article draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", o.id); onDrag(true); }} onDragEnd={() => onDrag(false)}
      title="Arraste para outra etapa" style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 9, cursor: "grab", opacity: dragging ? 0.5 : 1 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <button onClick={onOpen} style={{ ...link, fontSize: 14, lineHeight: "18px" }}>{o.company}</button>
        <span style={{ fontSize: 12, color: c.muted }}>{o.services || "—"}</span>
      </div>
      <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ height: 22, display: "inline-flex", alignItems: "center", padding: "0 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: st.bg, color: st.ink }}>{st.label}</span>
        <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{o.proposedValue ? `${eur(value(o))}/mês` : o.l2bMonthly ? `L2B ${fmtEur(o.l2bMonthly)}` : ""}</span>
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: c.muted, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {o.nosOp ? <>OP {o.nosOp} <CopyButton text={o.nosOp} /></> : "Sem OP"} · {days === 0 ? "atividade hoje" : `${days} ${days === 1 ? "dia" : "dias"} sem atividade`}
          </span>
          <div style={{ height: 4, borderRadius: 999, background: c.line, overflow: "hidden" }}><div style={{ height: 4, width: `${Math.min(100, Math.round((days / 7) * 100))}%`, background: bar }} /></div>
        </div>
        {showOwner && <Avatar name={o.owner} photo={photo} size={34} ring={bar} />}
      </div>
      {o.nextTaskAt && <span style={{ fontSize: 12 }}>Próxima tarefa: {fmtDate(o.nextTaskAt)}</span>}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button style={small} onClick={() => onAction("activity")}>Atividade</button>
        <button style={small} onClick={() => onAction("move")}>Etapa</button>
        <button style={{ ...small, color: c.ok }} onClick={onWin}>Ganha</button>
        <button style={{ ...small, color: c.danger }} onClick={() => onAction("lose")}>Perdida</button>
      </div>
    </article>
  );
}

/** Pipeline por comercial (Administrador e Chefe de Equipa): uma linha por pessoa, com os cartões em cada etapa. */
function PorComercial({ rows, people, onOpen }: { rows: Opportunity[]; people: { id: string; name: string; photo: string | null }[]; onOpen: (id: string) => void }) {
  const owners = people.filter((p) => rows.some((o) => o.ownerId === p.id));
  if (!owners.length) return <section style={{ ...card, padding: 24, color: c.muted }}>Sem oportunidades em curso.</section>;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 1200, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "240px repeat(5, minmax(0, 1fr))", gap: 10 }}>
          <span />
          {OPEN.map((s) => <div key={s.id} style={{ height: 38, borderRadius: 10, padding: "0 12px", display: "flex", alignItems: "center", background: STAGE_COLOR[s.id]!.bg, color: STAGE_COLOR[s.id]!.ink, fontSize: 14, fontWeight: 800 }}>{s.label}</div>)}
        </div>
        {owners.map((p) => {
          const mine = rows.filter((o) => o.ownerId === p.id);
          const lateN = mine.filter((o) => o.alert?.level === "late").length, warnN = mine.filter((o) => o.alert?.level === "warn").length;
          return (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: "240px repeat(5, minmax(0, 1fr))", gap: 10, alignItems: "stretch" }}>
              <div style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={p.name} photo={p.photo} size={48} ring={c.brand} /><b style={{ fontSize: 15 }}>{p.name}</b></span>
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                  <div><dt style={{ fontSize: 11, color: c.muted }}>Abertas</dt><dd style={{ margin: 0, fontWeight: 800, fontSize: 17 }}>{mine.length}</dd></div>
                  <div><dt style={{ fontSize: 11, color: c.muted }}>Atrasadas · alerta</dt><dd style={{ margin: 0, fontWeight: 800, fontSize: 15, color: lateN ? c.danger : c.ink }}>{lateN} · {warnN}</dd></div>
                  <div style={{ gridColumn: "span 2" }}><dt style={{ fontSize: 11, color: c.muted }}>Valor mensal</dt><dd style={{ margin: 0, fontWeight: 800, fontSize: 15 }}>{eur(mine.reduce((a, o) => a + value(o), 0))}</dd></div>
                </dl>
              </div>
              {OPEN.map((s) => {
                const list = mine.filter((o) => o.stage === s.id);
                return (
                  <div key={s.id} style={{ background: c.sunken, border: `1px solid ${c.line}`, borderTop: `3px solid ${STAGE_COLOR[s.id]!.bar}`, borderRadius: 14, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 11, color: c.muted }}>{list.length} · {eur(list.reduce((a, o) => a + value(o), 0))}</span>
                    {list.map((o) => {
                      const st = statusPill(o.alert?.level ?? "ok");
                      return (
                        <button key={o.id} onClick={() => onOpen(o.companyId)} style={{ ...card, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5, cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: c.ink }}>
                          <b style={{ fontSize: 13, lineHeight: "17px" }}>{o.company}</b>
                          <span style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                            <span style={{ height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: st.bg, color: st.ink }}>{st.label}</span>
                            <span style={{ fontSize: 11, color: c.muted }}>{o.proposedValue ? eur(value(o)) : ""}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Activity({ o, onClose, onDone }: { o: Opportunity; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title={`Registar atividade · ${o.company}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={{ fontSize: 13, color: c.muted }}>Uma atividade relevante recomeça a contagem dos sete dias e fica no histórico da empresa.</span>
        <Field label="O que aconteceu"><input style={input} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: cliente pediu nova simulação com 5 linhas" /></Field>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={btnDark} disabled={text.trim().length < 3} onClick={() => api.opportunityActivity(o.id, text).then(onDone).catch((e) => setErr(e.message))}>Registar</button>
        </div>
      </div>
    </Modal>
  );
}

const NEEDS_OP = ["proposal", "negotiation", "documents", "won"];
/** OP da NOS: 7 algarismos. */
function OpField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Field label="OP (7 algarismos) · obrigatória a partir de Proposta enviada"><input style={{ ...input, width: 180, letterSpacing: ".08em", fontWeight: 700 }} inputMode="numeric" maxLength={7} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} placeholder="7123456" /></Field>;
}

function Move({ o, initial, onClose, onDone }: { o: Opportunity; initial?: string; onClose: () => void; onDone: () => void }) {
  const [stage, setStage] = useState(initial ?? o.stage);
  const [comment, setComment] = useState("");
  const [op, setOp] = useState("");
  const [err, setErr] = useState("");
  const askOp = NEEDS_OP.includes(stage) && !o.nosOp;
  return (
    <Modal title={`Mudar de etapa · ${o.company}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OPEN.map((s) => <button key={s.id} onClick={() => setStage(s.id)} style={{ ...btn, height: 34, fontSize: 13, background: stage === s.id ? c.ink : c.card, color: stage === s.id ? c.onInk : c.ink }}>{s.label}</button>)}
        </div>
        {askOp && <OpField value={op} onChange={setOp} />}
        <Field label="Comentário (opcional)"><input style={input} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={btnDark} disabled={stage === o.stage || (askOp && op.length !== 7)} onClick={() => api.moveOpportunity(o.id, stage, comment || undefined, askOp ? op : undefined).then(onDone).catch((e) => setErr(e.message))}>Mudar</button>
        </div>
      </div>
    </Modal>
  );
}

/** Ganha (23 nov): OP e valor da venda ao cêntimo (vem da proposta; o comercial confirma ou corrige). */
function Win({ o, onClose, onDone }: { o: Opportunity; onClose: () => void; onDone: () => void }) {
  const fmt = (n: number) => n.toFixed(2).replace(".", ",");
  const [types, setTypes] = useState<TypesDraft>(() => Object.fromEntries(Object.entries(o.saleTypes ?? {}).map(([k, v]) => [k, fmt(Number(v))])) as TypesDraft);
  const [op, setOp] = useState("");
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const nums = typesToNumbers(types);
  const typesErr = saleTypesError(nums);
  const total = Object.values(nums).reduce((a, v) => a + (v ?? 0), 0);
  const ready = !typesErr && ok && (o.nosOp || op.length === 7);
  return (
    <Modal title={`Ganha · ${o.company}`} onClose={onClose} width={640}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {o.nosOp ? <span style={{ fontSize: 13 }}>OP <b>{o.nosOp}</b></span> : <OpField value={op} onChange={setOp} />}
        {o.proposedValue && <span style={{ fontSize: 13, color: c.muted }}>Proposta: {eur(Number(o.proposedValue))}/mês. Confirme ou corrija os valores da venda, ao cêntimo.</span>}
        <SaleTypesPicker types={types} setTypes={(f) => { setOk(false); setTypes(f); }} />
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={ok} disabled={!!typesErr} onChange={(e) => setOk(e.target.checked)} /> Confirmo a venda: {eur(total)}/mês
        </label>
        <span style={{ fontSize: 12, color: c.muted }}>Se a empresa não tiver carteira, passa para a carteira de {o.owner}. Conta como venda no dia de hoje.</span>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={btnDark} disabled={!ready || busy} onClick={() => { setBusy(true); api.winOpportunity(o.id, nums, o.nosOp ? undefined : op).then(onDone).catch((e) => setErr(e.message)).finally(() => setBusy(false)); }}>Marcar como Ganha</button>
        </div>
      </div>
    </Modal>
  );
}

export function Lose({ o, reasons, onClose, onDone, title, submit, button = "Marcar como perdida" }: { o: { company: string; id?: string }; reasons: Reason[]; onClose: () => void; onDone: () => void; title?: string; button?: string;
  submit?: (reasonId: string, comment: string | undefined, extra: { operator: string; date: string } | undefined) => Promise<unknown> }) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const [operator, setOperator] = useState("");
  const [date, setDate] = useState("");
  // Outra operadora (igual à recusa): operadora e data de fim; contacto automático X meses antes.
  const byOperator = reason?.effect === "loyalty_end" || reason?.effect === "new_contract";
  const ok = !!reason && (reason.effect !== "other" || comment.trim().length > 0) && (!byOperator || (!!operator && !!date));
  return (
    <Modal title={title ?? `Oportunidade perdida · ${o.company}`} onClose={onClose} width={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Motivo (obrigatório)">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{reasons.map((r) => <button key={r.id} onClick={() => setReason(r)} style={{ ...btn, height: 32, fontSize: 12, background: reason?.id === r.id ? c.ink : c.card, color: reason?.id === r.id ? c.onInk : c.ink }}>{r.label}</button>)}</div>
        </Field>
        {byOperator && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, border: `1px solid ${c.line}`, borderRadius: 12 }}>
            <Field label="Operadora atual (obrigatório)"><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{["NOS", "MEO", "Vodafone", "DIGI", "NOWO", "Outra", "NS/NR"].map((op) => <button key={op} onClick={() => setOperator(op)} style={{ ...btn, height: 30, fontSize: 12, background: operator === op ? c.ink : c.card, color: operator === op ? c.onInk : c.ink }}>{op}</button>)}</div></Field>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Field label="Fim de fidelização (obrigatório)"><DatePicker value={date === "NS/NR" ? "" : date} onChange={setDate} disabled={date === "NS/NR"} width={200} ariaLabel="Fim de fidelização" /></Field>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600, alignSelf: "flex-end", height: 40 }}><input type="checkbox" checked={date === "NS/NR"} onChange={(e) => setDate(e.target.checked ? "NS/NR" : "")} /> Cliente não refere (NS/NR)</label>
            </div>
            {operator && date && <span style={{ fontSize: 13, padding: "8px 12px", background: c.brandSoft, borderRadius: 10 }}>{operatorRefusalNote(operator, date, reason!.monthsBefore ?? 4, reason!.unknownMonths ?? 6)}</span>}
          </div>
        )}
        <Field label={reason?.effect === "other" ? "Descrição (obrigatória)" : "Comentário"}><input style={input} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        {reason && !byOperator && <span style={{ fontSize: 13, padding: "8px 12px", background: c.brandSoft, borderRadius: 10 }}>{reason.effect === "company_closed" ? "A empresa fica encerrada e sai de todas as campanhas." : reason.effect === "cooldown" ? `Volta a poder entrar em campanhas daqui a ${reason.days} dias.` : "Volta a poder entrar em campanhas daqui a seis meses."}</span>}
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={{ ...btnDark, background: c.danger, borderColor: c.danger }} disabled={!ok} onClick={() => (submit ?? ((r, cm, x) => api.loseOpportunity(o.id!, r, cm, x)))(reason!.id, comment || undefined, byOperator ? { operator, date } : undefined).then(onDone).catch((e) => setErr(e.message))}>{button}</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Números do Pipeline (20 nov): N.º de OPs abertas, valor, ganhos e perdidos do ciclo, em atraso.
 * Comercial e Chefe de Equipa em pontos (plano comissional); Administrador em € pela Receita NOS.
 * Chefe de Equipa: por comercial e por equipa. Administrador: por comercial, por equipa e total.
 */
function PipelineNumbers({ me }: { me: User }) {
  const [s, setS] = useState<PipelineStats | null>(null);
  const [by, setBy] = useState<"total" | "user" | "team">("total");
  useEffect(() => { api.pipelineStats().then(setS).catch(() => undefined); }, []);
  if (!s) return null;
  const fmt = (v: number) => (s.metric === "eur" ? eur(v) : `${fmtInt(v)} pts`);
  const unit = s.metric === "eur" ? "Receita NOS ponderada" : "pontos do plano";
  const tiles: [string, string, string][] = [
    ["N.º de OPs", String(s.total.open), `abertas · ${fmt(s.total.openValue)}`],
    ["Valor em pipeline", fmt(s.total.openValue), unit],
    ["Ganhos no ciclo", `${s.total.won} · ${fmt(s.total.wonValue)}`, s.cycle],
    ["Perdidos no ciclo", `${s.total.lost} · ${fmt(s.total.lostValue)}`, s.cycle],
    ["Em atraso", String(s.total.late), "sem atividade há 7 dias ou mais"],
  ];
  const lead = me.role !== "sales";
  const rows: (PipelineAgg & { name: string; id?: string; team?: string | null })[] = by === "user" ? s.byUser : by === "team" ? s.byTeam : [];
  const pill = (on: boolean) => ({ border: 0, height: 30, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: on ? 700 : 600, background: on ? c.ink : "transparent", color: on ? c.onInk : c.muted });
  const th = { padding: "8px 12px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" as const, color: c.muted, textAlign: "right" as const };
  const td = { padding: "8px 12px", fontSize: 13, textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const };
  return (
    <section aria-label="Resumo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
        {tiles.map(([l, v, h]) => (
          <div key={l} style={{ ...card, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 12, color: c.muted }}>{l}</span>
            <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
            <span style={{ fontSize: 12, color: c.muted }}>{h}</span>
          </div>
        ))}
      </div>
      {lead && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div role="group" aria-label="Números por" style={{ display: "flex", alignSelf: "flex-start", padding: 3, borderRadius: 999, background: c.card, border: `1px solid ${c.line}` }}>
            <button style={pill(by === "total")} onClick={() => setBy("total")}>Total</button>
            <button style={pill(by === "user")} onClick={() => setBy("user")}>Por comercial</button>
            <button style={pill(by === "team")} onClick={() => setBy("team")}>Por equipa</button>
          </div>
          {by !== "total" && (
            <div style={{ ...card, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: c.sunken }}><th style={{ ...th, textAlign: "left" }}>{by === "user" ? "Comercial" : "Equipa"}</th><th style={th}>N.º de OPs</th><th style={th}>Valor em pipeline</th><th style={th}>Ganhos</th><th style={th}>Perdidos</th><th style={th}>Em atraso</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id ?? r.name} style={{ borderTop: `1px solid ${c.line}` }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{r.name}{r.team ? <span style={{ color: c.muted, fontWeight: 400 }}> · {r.team}</span> : null}</td>
                    <td style={td}>{r.open}</td><td style={td}>{fmt(r.openValue)}</td><td style={td}>{r.won} · {fmt(r.wonValue)}</td><td style={td}>{r.lost} · {fmt(r.lostValue)}</td>
                    <td style={{ ...td, color: r.late ? c.danger : c.ink, fontWeight: r.late ? 700 : 400 }}>{r.late}</td>
                  </tr>
                ))}{!rows.length && <tr><td colSpan={6} style={{ ...td, textAlign: "left", color: c.muted }}>Sem oportunidades.</td></tr>}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
