import { operatorRefusalNote } from "@basecom/shared";
import { useEffect, useMemo, useState } from "react";
import type { Catalogs, Outcome, Reason, ResultInput } from "../api";
import { btn, btnDark, c, card, ErrorText, Field, input } from "../ui";

export const GROUPS = [
  { id: "refuse", label: "Recusa", key: "1" }, { id: "callback", label: "Callback", key: "2" }, { id: "noanswer", label: "Não atende", key: "3" },
  { id: "proposal", label: "Proposta", key: "4" }, { id: "sale", label: "Venda", key: "5" }, { id: "other", label: "Outro", key: "6" },
] as const;
export type Group = (typeof GROUPS)[number]["id"];
const OPERATORS = ["NOS", "MEO", "Vodafone", "DIGI", "NOWO", "Outra"];

/** Data local «AAAA-MM-DDTHH:MM» → instante ISO. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

/**
 * Ecrã do resultado (maquetas «Resultado»): botões do grupo, opções, motivo, comentários e feedback de outra operadora.
 * Mostra o tempo que falta para registar (15 s por omissão); ultrapassar não bloqueia, mas fica registado.
 */
export function ResultPanel({ cat, group, company, endedAt, busy, error, hidden, needsKind, onGroup, onBack, onSave }: {
  hidden?: boolean; needsKind?: boolean; cat: Catalogs; group: Group; company: { name: string; nif: string; phone?: string; decisor?: string };
  endedAt: number; busy: boolean; error: string; onGroup: (g: Group) => void; onBack: () => void; onSave: (r: ResultInput) => void;
}) {
  const options = useMemo(() => cat.catalogs.outcomes.filter((o) => o.active && o.group === group), [cat, group]);
  const [outcome, setOutcome] = useState<Outcome | null>(options.length === 1 ? options[0]! : null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [comment, setComment] = useState("");
  const [date, setDate] = useState("");
  const [at, setAt] = useState("");
  const [forMe, setForMe] = useState(true);
  const [nextAction, setNextAction] = useState("");
  const [services, setServices] = useState("");
  const [decisorName, setDecisorName] = useState("");
  const [comp, setComp] = useState<{ operator?: string; text?: string }>({});
  const [kind, setKind] = useState<"NC" | "FC" | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setOutcome(options.length === 1 ? options[0]! : null); setReason(null); }, [group]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const limit = cat.timeLimits.resultSeconds;
  const secs = Math.floor((now - endedAt) / 1000);

  const eff = outcome?.effect;
  /** Recusa por outro operador: operadora obrigatória e nova abordagem na data que o cliente sugerir (não automática). */
  const byOperator = reason?.effect === "loyalty_end" || reason?.effect === "new_contract";
  // NC/FC só quando houve conversa (num «Não atendeu» não se pede).
  const askKind = needsKind && !!outcome && !["no_answer", "busy", "voicemail", "wrong_number"].includes(outcome.effect);
  const needsAt = eff === "call_later" || eff === "interested" || eff === "proposal_sent" || eff === "negotiating" || reason?.effect === "other";
  const ready = (!askKind || !!kind) && (!byOperator || (!!comp.operator && !!date)) && !!outcome && (eff !== "not_interested" || !!reason) && (reason?.effect !== "other" || comment.trim().length > 0)
    && (eff !== "call_later" || !!at) && (!["interested", "proposal_sent", "negotiating"].includes(eff ?? "") || (!!at && nextAction.trim().length > 0));

  const nextContact = useMemo(() => {
    if (!reason) return null;
        if (reason.effect === "cooldown") return `Pode voltar a uma campanha daqui a ${reason.days} dias`;
    if (reason.effect === "followup_task") return `Tarefa de seguimento daqui a ${reason.days} dias`;
    if (reason.effect === "company_closed") return "Empresa marcada como encerrada e retirada de todas as campanhas";
    if (reason.effect === "loyalty_end" || reason.effect === "new_contract") return null;
    return "Defina a data da nova abordagem (opcional)";
  }, [reason, date]);

  function save() {
    if (!ready || !outcome) return;
    onSave({
      outcomeId: outcome.id, reasonId: reason?.id, comment: comment.trim() || undefined, date: date || undefined, at: toIso(at),
      forMe: eff === "call_later" ? forMe : undefined, nextAction: nextAction.trim() || undefined, services: services.trim() || undefined,
      decisorName: decisorName.trim() || undefined, competitor: comp.operator || comp.text ? comp : undefined, walletKind: askKind && kind ? kind : undefined,
    });
  }
  useEffect(() => {
    if (hidden) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName !== "TEXTAREA")) { e.preventDefault(); save(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const pill = (on: boolean) => ({ ...btn, height: 34, fontSize: 13, background: on ? c.ink : c.card, color: on ? "#FFF" : c.ink, borderColor: on ? c.ink : c.line });
  return (
    <section style={{ ...card, padding: 20, display: hidden ? "none" : "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0, overflow: "auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Chamada terminada</span>
          <h2 style={{ margin: "2px 0", fontSize: 20 }}>{company.name}</h2>
          <span style={{ fontSize: 13, color: c.muted }}>NIF {company.nif}{company.phone ? ` · ${company.phone}` : ""}{company.decisor ? ` · ${company.decisor}` : ""}</span>
        </div>
        <div role="timer" style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: c.muted }}>Tempo para registar (desde que desligou)</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: secs > limit ? "#D70015" : c.ink }}>{secs} / {limit} s</div>
        </div>
      </header>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {GROUPS.map((g) => <button key={g.id} style={pill(g.id === group)} onClick={() => onGroup(g.id)}>{g.label}</button>)}
      </div>

      {options.length > 1 && (
        <Field label="Resultado">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{options.map((o) => <button key={o.id} style={pill(outcome?.id === o.id)} onClick={() => setOutcome(o)}>{o.label}</button>)}</div>
        </Field>
      )}

      {eff === "not_interested" && (
        <Field label="Motivo da recusa">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{cat.catalogs.reasons.filter((r) => r.active).map((r) => <button key={r.id} style={pill(reason?.id === r.id)} onClick={() => setReason(r)}>{r.label}</button>)}</div>
        </Field>
      )}
      {byOperator && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, border: `1px solid ${c.line}`, borderRadius: 12 }}>
          <Field label="Operadora atual (obrigatório)"><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{OPERATORS.map((o) => <button key={o} style={{ ...pill(comp.operator === o), height: 30, fontSize: 12 }} onClick={() => setComp({ ...comp, operator: o })}>{o}</button>)}</div></Field>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Field label="Fim de fidelização (obrigatório)"><input style={{ ...input, width: 200 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          {comp.operator && date && <div style={{ fontSize: 13, padding: "8px 12px", background: c.brandSoft, borderRadius: 10 }}>{operatorRefusalNote(comp.operator, date, reason?.monthsBefore ?? 4)}</div>}
        </div>
      )}
      {nextContact && <div style={{ fontSize: 13, padding: "8px 12px", background: c.brandSoft, borderRadius: 10 }}><b>Próximo contacto (automático):</b> {nextContact}</div>}

      {eff === "decisor_absent" && <Field label="Nome do decisor (se souber)"><input style={input} value={decisorName} onChange={(e) => setDecisorName(e.target.value)} /></Field>}
      {needsAt && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          {["interested", "proposal_sent", "negotiating"].includes(eff ?? "") && <Field label="Próxima ação"><input style={{ ...input, width: 300 }} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Ex.: enviar proposta 4P" /></Field>}
          <Field label={eff === "call_later" ? "Voltar a ligar em" : reason?.effect === "other" ? "Nova abordagem em (opcional)" : "Data da próxima ação"}><input style={{ ...input, width: 230 }} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          {eff === "call_later" && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, paddingBottom: 8 }}><input type="checkbox" checked={forMe} onChange={(e) => setForMe(e.target.checked)} /> Agendar para mim</label>}
        </div>
      )}
      {(eff === "proposal_sent" || eff === "negotiating") && <Field label="Serviços propostos"><input style={input} value={services} onChange={(e) => setServices(e.target.value)} placeholder="Ex.: 4 linhas móveis + internet fixa" /></Field>}
      {eff === "sale" && <p style={{ margin: 0, fontSize: 13, padding: "8px 12px", background: "#E8F5EC", borderRadius: 10 }}>A empresa passa para a sua carteira (se ainda não tiver responsável). O registo das linhas e dos serviços vendidos chega com o módulo de Vendas (Arranque B).</p>}

      <Field label={reason?.effect === "other" ? "Comentários (obrigatório no motivo «Outro»)" : "Comentários"}>
        <textarea style={{ ...input, height: 64, padding: 10, resize: "vertical" }} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>

      {askKind && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", background: c.warnSoft, borderRadius: 10 }}>
          <b style={{ fontSize: 13 }}>Cliente NOS sem NC/FC: identifique (obrigatório)</b>
          {(["NC", "FC"] as const).map((k) => <button key={k} style={pill(kind === k)} onClick={() => setKind(k)}>{k}</button>)}
        </div>
      )}

      {!byOperator && <details>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Feedback de outra operadora</summary>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <Field label="Operadora atual"><div style={{ display: "flex", gap: 4 }}>{OPERATORS.map((o) => <button key={o} style={{ ...pill(comp.operator === o), height: 30, fontSize: 12 }} onClick={() => setComp({ ...comp, operator: comp.operator === o ? undefined : o })}>{o}</button>)}</div></Field>
          <Field label="Fim de fidelização"><input style={{ ...input, width: 170 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="O que diz da operadora atual"><input style={{ ...input, marginTop: 6 }} value={comp.text ?? ""} onChange={(e) => setComp({ ...comp, text: e.target.value || undefined })} placeholder="Ex.: paga 120 €/mês por 4 linhas e internet" /></Field>
      </details>}
      {byOperator && <Field label="O que diz da operadora atual"><input style={input} value={comp.text ?? ""} onChange={(e) => setComp({ ...comp, text: e.target.value || undefined })} placeholder="Ex.: paga 120 €/mês por 4 linhas e internet" /></Field>}

      <ErrorText>{error}</ErrorText>
      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
        <button style={btn} onClick={onBack}>← Voltar ao script</button>
        <button style={{ ...btnDark, height: 44, padding: "0 22px" }} disabled={!ready || busy} onClick={save}>{busy ? "A guardar…" : "Guardar resultado ⏎"}</button>
      </footer>
    </section>
  );
}
