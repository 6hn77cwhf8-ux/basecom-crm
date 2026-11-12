import { useEffect, useState } from "react";
import { OPPORTUNITY_STAGES } from "@basecom/shared";
import { api, type Catalogs, type Opportunity, type Reason, type User } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, Field, fmtDate, fmtEur, input, PageHeader } from "../ui";
import { Modal } from "./Wallet";

const OPEN = OPPORTUNITY_STAGES.filter((s) => s.open);

/**
 * Oportunidades (catálogo, secção 3): quadro com as cinco etapas abertas.
 * Regra dos sete dias: alerta ao 5.º dia, atrasada ao 7.º (prazos configuráveis); nunca fecha sozinha.
 */
export function Opportunities({ me, onOpenCompany }: { me: User; onOpenCompany: (id: string) => void }) {
  const isAdmin = me.role === "admin";
  const [rows, setRows] = useState<Opportunity[] | null>(null);
  const [closed, setClosed] = useState(false);
  const [owner, setOwner] = useState("");
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [cat, setCat] = useState<Catalogs | null>(null);
  const [dialog, setDialog] = useState<{ kind: "activity" | "lose" | "move"; o: Opportunity } | null>(null);
  const [error, setError] = useState("");
  const load = () => api.opportunities({ ownerId: owner || undefined, closed }).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [owner, closed]);
  useEffect(() => { api.catalogs().then(setCat).catch(() => undefined); if (isAdmin) api.agendaPeople().then(setPeople).catch(() => undefined); }, []);

  const late = rows?.filter((o) => o.alert?.level === "late").length ?? 0;
  const warn = rows?.filter((o) => o.alert?.level === "warn").length ?? 0;

  return (
    <>
      <PageHeader eyebrow="Trabalho comercial" title="Oportunidades" actions={<>
        {isAdmin && <select aria-label="Comercial" style={{ ...input, height: 38, width: 200 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Todos os comerciais</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <button style={btn} onClick={() => setClosed(!closed)}>{closed ? "Ver em curso" : "Ver fechadas (90 dias)"}</button>
      </>} />
      {!closed && rows && (late > 0 || warn > 0) && (
        <p role="status" style={{ margin: 0, padding: "10px 14px", borderRadius: 10, background: late ? "#FFE5E7" : "#FFF4E5", color: late ? "#A1000F" : "#8A3D00", fontSize: 14, fontWeight: 600 }}>
          {late > 0 && `${late} atrasada${late === 1 ? "" : "s"} (7 dias ou mais sem atividade)`}{late > 0 && warn > 0 && " · "}{warn > 0 && `${warn} em alerta (5 dias)`}. Cada oportunidade deve ter uma decisão em sete dias.
        </p>
      )}
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
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${OPEN.length}, minmax(200px, 1fr))`, gap: 10, alignItems: "start", overflowX: "auto" }}>
          {OPEN.map((s) => {
            const list = rows?.filter((o) => o.stage === s.id) ?? [];
            return (
              <section key={s.id} style={{ background: "#ECECF0", borderRadius: 14, padding: 8, display: "flex", flexDirection: "column", gap: 8, minHeight: 120 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 6px" }}><b style={{ fontSize: 13 }}>{s.label}</b><span style={{ fontSize: 12, color: c.muted }}>{list.length}</span></div>
                {list.map((o) => <OppCard key={o.id} o={o} showOwner={isAdmin && !owner} onOpen={() => onOpenCompany(o.companyId)} onAction={(kind) => setDialog({ kind, o })}
                  onWin={() => confirm(`Marcar «${o.company}» como Ganha? Se a empresa não tiver carteira, passa para a carteira de ${o.owner}.`) && api.winOpportunity(o.id).then(load).catch((e) => setError(e.message))} />)}
              </section>
            );
          })}
        </div>
      )}
      {dialog?.kind === "activity" && <Activity o={dialog.o} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.kind === "move" && <Move o={dialog.o} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.kind === "lose" && cat && <Lose o={dialog.o} reasons={cat.catalogs.reasons.filter((r) => r.active)} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </>
  );
}

const link = { border: 0, background: "none", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: 14, color: c.ink, textAlign: "left" as const, fontFamily: "inherit" };
const small = { ...btn, height: 28, fontSize: 12, padding: "0 8px" };

function OppCard({ o, showOwner, onOpen, onAction, onWin }: { o: Opportunity; showOwner: boolean; onOpen: () => void; onAction: (k: "activity" | "lose" | "move") => void; onWin: () => void }) {
  const lvl = o.alert?.level ?? "ok";
  return (
    <article style={{ ...card, padding: 12, display: "flex", flexDirection: "column", gap: 6, borderColor: lvl === "late" ? "#D70015" : lvl === "warn" ? "#E8A23A" : c.line }}>
      <button onClick={onOpen} style={{ ...link, fontSize: 13 }}>{o.company}</button>
      <span style={{ fontSize: 12, color: c.muted }}>{[o.services, o.l2bMonthly ? `L2B ${fmtEur(o.l2bMonthly)}` : null].filter(Boolean).join(" · ") || "—"}</span>
      <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Chip tone={lvl === "late" ? "bad" : lvl === "warn" ? "warn" : "neutral"}>{lvl === "late" ? "Atrasada · " : lvl === "warn" ? "Alerta · " : ""}{o.alert?.days ?? 0} d sem atividade</Chip>
        {showOwner && <span style={{ fontSize: 12, color: c.muted }}>{o.owner}</span>}
      </span>
      {o.nextTaskAt && <span style={{ fontSize: 12 }}>Próxima tarefa: {fmtDate(o.nextTaskAt)}</span>}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
        <button style={small} onClick={() => onAction("activity")}>Atividade</button>
        <button style={small} onClick={() => onAction("move")}>Etapa</button>
        <button style={{ ...small, color: "#1E6F33" }} onClick={onWin}>Ganha</button>
        <button style={{ ...small, color: "#A1000F" }} onClick={() => onAction("lose")}>Perdida</button>
      </div>
    </article>
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

function Move({ o, onClose, onDone }: { o: Opportunity; onClose: () => void; onDone: () => void }) {
  const [stage, setStage] = useState(o.stage);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title={`Mudar de etapa · ${o.company}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OPEN.map((s) => <button key={s.id} onClick={() => setStage(s.id)} style={{ ...btn, height: 34, fontSize: 13, background: stage === s.id ? c.ink : c.card, color: stage === s.id ? "#FFF" : c.ink }}>{s.label}</button>)}
        </div>
        <Field label="Comentário (opcional)"><input style={input} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={btnDark} disabled={stage === o.stage} onClick={() => api.moveOpportunity(o.id, stage, comment || undefined).then(onDone).catch((e) => setErr(e.message))}>Mudar</button>
        </div>
      </div>
    </Modal>
  );
}

function Lose({ o, reasons, onClose, onDone }: { o: Opportunity; reasons: Reason[]; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const ok = !!reason && (reason.effect !== "other" || comment.trim().length > 0);
  return (
    <Modal title={`Oportunidade perdida · ${o.company}`} onClose={onClose} width={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Motivo (obrigatório)">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{reasons.map((r) => <button key={r.id} onClick={() => setReason(r)} style={{ ...btn, height: 32, fontSize: 12, background: reason?.id === r.id ? c.ink : c.card, color: reason?.id === r.id ? "#FFF" : c.ink }}>{r.label}</button>)}</div>
        </Field>
        <Field label={reason?.effect === "other" ? "Descrição (obrigatória)" : "Comentário"}><input style={input} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        {reason && <span style={{ fontSize: 13, padding: "8px 12px", background: c.brandSoft, borderRadius: 10 }}>{reason.effect === "company_closed" ? "A empresa fica encerrada e sai de todas as campanhas." : reason.effect === "cooldown" ? `Volta a poder entrar em campanhas daqui a ${reason.days} dias.` : "Volta a poder entrar em campanhas daqui a seis meses."}</span>}
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={{ ...btnDark, background: "#A1000F", borderColor: "#A1000F" }} disabled={!ok} onClick={() => api.loseOpportunity(o.id, reason!.id, comment || undefined).then(onDone).catch((e) => setErr(e.message))}>Marcar como perdida</button>
        </div>
      </div>
    </Modal>
  );
}
