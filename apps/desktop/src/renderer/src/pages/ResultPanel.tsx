import { callbackLimit, FOLLOW_UPS, type FollowUp, operatorRefusalNote, quickCallbackAt, renderMessage, saleTypesError, type QuickCallback } from "@basecom/shared";
import { useEffect, useMemo, useState } from "react";
import { api, type Catalogs, type Outcome, type Reason, type ResultInput } from "../api";
import { btn, btnDark, c, card, ErrorText, Field, input } from "../ui";
import { OpField, opValid, SaleTypesPicker, typesToNumbers, type TypesDraft } from "./ClientWork";
import { DatePicker } from "./DatePicker";

export const GROUPS = [
  { id: "refuse", label: "Recusa", key: "1" }, { id: "callback", label: "Callback", key: "2" }, { id: "noanswer", label: "Não atende", key: "3" },
  { id: "proposal", label: "Proposta", key: "4" }, { id: "sale", label: "Venda", key: "5" }, { id: "other", label: "Outro", key: "6" },
] as const;
export type Group = (typeof GROUPS)[number]["id"];
const OPERATORS = ["NOS", "MEO", "Vodafone", "DIGI", "NOWO", "Outra", "NS/NR"];

/** Data local «AAAA-MM-DDTHH:MM» → instante ISO. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Data no formato do calendário (hora do computador). */
const toLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const QUICK: [QuickCallback, string][] = [["1h", "1 hora"], ["1d", "1 dia"], ["1w", "1 semana"], ["1m", "1 mês"]];

/**
 * Ecrã do resultado (maquetas «Resultado»): botões do grupo, opções, motivo, comentários e feedback de outra operadora.
 * Mostra o tempo que falta para registar (15 s por omissão); ultrapassar não bloqueia, mas fica registado.
 */
export function ResultPanel({ cat, group, company, endedAt, busy, error, hidden, needsKind, walletKind, live, backLabel, onGroup, onBack, onSave, onOpenCompany, triedSms, onSms }: {
  /** Botão «Abrir ficha» ao lado do nome (18 nov). */
  onOpenCompany?: () => void;
  /** SMS «Tentámos ligar» no 1.º não atende (18 nov): telemóvel do cliente e campos do modelo. */
  triedSms?: { to: string; vars: { decisor?: string; empresa?: string; comercial?: string } };
  onSms?: (text: string) => void;
  /** NC/FC da empresa (FC conta 50 % na previsão de pontos). */
  walletKind?: "NC" | "FC";
  backLabel?: string;
  /** Resultado aberto com a chamada ainda a decorrer no telemóvel: só grava quando a chamada acabar. */
  live?: { secs: number; queued: boolean; onHangUp: () => void };
  hidden?: boolean; needsKind?: boolean; cat: Catalogs; group: Group; company: { name: string; nif: string; phone?: string; decisor?: string };
  endedAt: number; busy: boolean; error: string; onGroup: (g: Group) => void; onBack: () => void; onSave: (r: ResultInput) => void;
}) {
  const options = useMemo(() => cat.catalogs.outcomes.filter((o) => o.active && o.group === group), [cat, group]);
  const [outcome, setOutcome] = useState<Outcome | null>(options.length === 1 ? options[0]! : null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [comment, setComment] = useState("");
  const [date, setDate] = useState("");
  const [at, setAt] = useState("");
  const [services, setServices] = useState("");
  const [decisorName, setDecisorName] = useState("");
  const [comp, setComp] = useState<{ operator?: string; text?: string }>({});
  const [kind, setKind] = useState<"NC" | "FC" | "NN" | null>(null);
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [smsText, setSmsText] = useState("");
  const [op, setOp] = useState("");
  // Tipos de venda e valor de cada um (€/mês): até 2 (FID + XSell ou FID + Upsell; NN sozinho).
  const [types, setTypes] = useState<TypesDraft>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setOutcome(options.length === 1 ? options[0]! : null); setReason(null); }, [group]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const limit = cat.timeLimits.resultSeconds;
  const secs = Math.max(0, Math.floor((now - endedAt) / 1000));

  const eff = outcome?.effect;
  /** Recusa por outro operador: operadora obrigatória e nova abordagem na data que o cliente sugerir (não automática). */
  const byOperator = reason?.effect === "loyalty_end" || reason?.effect === "new_contract";
  // NC/FC só quando houve conversa (num «Não atendeu» não se pede).
  const askKind = needsKind && !!outcome && !["no_answer", "busy", "voicemail", "wrong_number"].includes(outcome.effect);
  // Proposta enviada e Venda (17 nov): só a OP; o resto pede-se no «Guardar e fechar» do Em cliente.
  const needsAt = eff === "call_later" || eff === "interested" || eff === "negotiating" || reason?.effect === "other";
  // Proposta enviada e Venda fechada: OP obrigatória e, ao guardar, começa o tempo «Em cliente».
  const workKind = eff === "proposal_sent" ? "proposal" : eff === "sale" ? "sale" : null;
  // Em negociação: tipos e valor obrigatórios (sem valor não se contabiliza).
  const withTypes = eff === "negotiating";
  const saleTypes = typesToNumbers(types);
  const typesErr = withTypes ? saleTypesError(saleTypes) : null;
  const ready = !typesErr && (!workKind || opValid(op)) && (!askKind || !!kind) && (!byOperator || (!!comp.operator && !!date)) && !!outcome && (eff !== "not_interested" || !!reason) && (reason?.effect !== "other" || comment.trim().length > 0)
    && (eff !== "call_later" || !!at) && (!["interested", "negotiating"].includes(eff ?? "") || (!!at && !!followUp));
  // SMS «Tentámos ligar»: só no «Não atendeu» do 1.º não atende, para telemóveis.
  const showSms = !!triedSms && eff === "no_answer" && /^9\d{8}$/.test(triedSms.to.replace(/\D/g, ""));
  useEffect(() => {
    if (!showSms || smsText) return;
    api.messageTemplates().then((t) => { const m = t.find((x) => x.id === "tried_call"); if (m) setSmsText(renderMessage(m.text, triedSms!.vars)); }).catch(() => undefined);
  }, [showSms]);

  const nextContact = useMemo(() => {
    if (!reason) return null;
        if (reason.effect === "cooldown") return `Pode voltar a uma campanha daqui a ${reason.days} dias`;
    if (reason.effect === "followup_task") return `Tarefa de seguimento daqui a ${reason.days} dias`;
    if (reason.effect === "company_closed") return "Empresa marcada como encerrada e retirada de todas as campanhas";
    if (reason.effect === "loyalty_end" || reason.effect === "new_contract") return null;
    return "Defina a data da nova abordagem (opcional)";
  }, [reason, date]);

  function save(withSms = false) {
    if (!ready || !outcome) return;
    if (withSms && smsText.trim()) onSms?.(smsText.trim());
    onSave({
      outcomeId: outcome.id, reasonId: reason?.id, comment: comment.trim() || undefined, date: date || undefined, at: toIso(at),
      services: services.trim() || undefined,
      decisorName: decisorName.trim() || undefined, followUp: followUp ?? undefined, competitor: comp.operator || comp.text ? comp : undefined, walletKind: askKind && kind ? kind : undefined,
      opCode: workKind ? op : undefined,
      saleTypes: withTypes ? saleTypes : undefined,
    });
  }
  useEffect(() => {
    if (hidden) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName !== "TEXTAREA")) { e.preventDefault(); save(showSms && !!smsText.trim()); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const pill = (on: boolean) => ({ ...btn, height: 34, fontSize: 13, background: on ? c.ink : c.card, color: on ? c.onInk : c.ink, borderColor: on ? c.ink : c.line });
  return (
    <section style={{ ...card, padding: 20, display: hidden ? "none" : "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0, overflow: "auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: live ? c.ok : c.muted }}>{live ? "Em chamada" : "Chamada terminada"}</span>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: "2px 0", fontSize: 20 }}>{company.name}</h2>
            {onOpenCompany && <button type="button" onClick={onOpenCompany} style={{ ...btn, height: 28, padding: "0 10px", fontSize: 12 }}>Abrir ficha ↗</button>}
          </div>
          <span style={{ fontSize: 13, color: c.muted }}>NIF {company.nif}{company.phone ? ` · ${company.phone}` : ""}{company.decisor ? ` · ${company.decisor}` : ""}</span>
        </div>
        {live ? (
          <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: c.ok }}>{String(Math.floor(live.secs / 60)).padStart(2, "0")}:{String(live.secs % 60).padStart(2, "0")}</span>
          </div>
        ) : (
          <div role="timer" style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: c.muted }}>Tempo para registar (desde que desligou)</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: secs > limit ? "#D70015" : c.ink }}>{secs} / {limit} s</div>
          </div>
        )}
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
            <Field label="Fim de fidelização (obrigatório)"><DatePicker value={date === "NS/NR" ? "" : date} onChange={setDate} disabled={date === "NS/NR"} width={200} ariaLabel="Fim de fidelização" /></Field>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600, alignSelf: "flex-end", height: 40 }}><input type="checkbox" checked={date === "NS/NR"} onChange={(e) => setDate(e.target.checked ? "NS/NR" : "")} /> Cliente não refere (NS/NR)</label>
          </div>
          {comp.operator && date && <div style={{ fontSize: 13, padding: "8px 12px", background: c.brandSoft, borderRadius: 10 }}>{operatorRefusalNote(comp.operator, date, reason?.monthsBefore ?? 4, reason?.unknownMonths ?? 6)}</div>}
        </div>
      )}
      {nextContact && <div style={{ fontSize: 13, padding: "8px 12px", background: c.brandSoft, borderRadius: 10 }}><b>Próximo contacto (automático):</b> {nextContact}</div>}

      {eff === "decisor_absent" && <Field label="Nome do decisor (se souber)"><input style={input} value={decisorName} onChange={(e) => setDecisorName(e.target.value)} /></Field>}
      {needsAt && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          {/* Próxima ação (18 nov): só a lista de follow-ups, com a data ao lado. */}
          {["interested", "negotiating"].includes(eff ?? "") && <Field label="Próxima ação">
            <div role="radiogroup" aria-label="Próxima ação" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{FOLLOW_UPS.map((f) => <button key={f.id} type="button" role="radio" aria-checked={followUp === f.id} style={pill(followUp === f.id)} onClick={() => setFollowUp(f.id)}>{f.label}</button>)}</div>
          </Field>}
          {/* Callback (17 nov): atalhos e calendário só até ao limite (1 mês, configurável). */}
          {eff === "call_later" && (
            <div role="group" aria-label="Atalhos" style={{ display: "flex", gap: 6, flexBasis: "100%" }}>
              {QUICK.map(([k, l]) => {
                const v = toLocal(quickCallbackAt(k, new Date()));
                const on = at === v;
                return <button key={k} type="button" onClick={() => setAt(v)} style={{ ...btn, height: 48, minWidth: 110, flexDirection: "column", display: "flex", alignItems: "center", justifyContent: "center", gap: 0, border: on ? `2px solid ${c.brand}` : `1px solid ${c.line}`, background: on ? c.brandSoft : c.card }}>
                  <b style={{ fontSize: 14 }}>{l}</b><span style={{ fontSize: 11, color: c.muted, fontWeight: 500 }}>{v.slice(8, 10)}/{v.slice(5, 7)} · {v.slice(11)}</span>
                </button>;
              })}
            </div>
          )}
          <Field label={eff === "call_later" ? "Voltar a ligar em" : reason?.effect === "other" ? "Nova abordagem em (opcional)" : "Data da próxima ação"}>
            <DatePicker withTime workdaysOnly value={at} onChange={setAt} width={260} ariaLabel="Data e hora"
              min={toLocal(new Date()).slice(0, 10)} max={eff === "call_later" ? toLocal(callbackLimit(new Date(), cat.timeLimits.callbackMaxMonths ?? 1)).slice(0, 10) : undefined} />
          </Field>
          {eff === "call_later" && <span style={{ fontSize: 13, color: c.muted, paddingBottom: 10 }}>Volta à sua fila de chamadas à hora marcada (não vai para a Agenda).</span>}
        </div>
      )}
      {eff === "negotiating" && <Field label="Serviços propostos"><input style={input} value={services} onChange={(e) => setServices(e.target.value)} placeholder="Ex.: 4 linhas móveis + internet fixa" /></Field>}
      {withTypes && <SaleTypesPicker types={types} setTypes={setTypes} walletKind={kind === "NN" ? "NC" : kind ?? walletKind ?? "NC"} />}
      {workKind && (
        <div style={{ border: `2px solid ${c.brand}`, background: c.brandSoft, borderRadius: 14, padding: "14px 16px", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <OpField value={op} onChange={setOp} />
          <span style={{ flex: "1 1 260px", fontSize: 14, lineHeight: "21px" }}>Só precisa da OP agora. Fica logo em pausa («Em cliente»); os tipos, o valor{workKind === "proposal" ? ", o canal e a próxima ação" : ""} preenchem-se no fim, em «Guardar e fechar».</span>
        </div>
      )}
      {eff === "sale" && <p style={{ margin: 0, fontSize: 13, padding: "8px 12px", background: c.okSoft, borderRadius: 10 }}>A empresa passa para a sua carteira (se ainda não tiver responsável).</p>}

      {showSms && (
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8, background: c.sunken }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><b style={{ fontSize: 14 }}>SMS «Tentámos ligar» · 1.º não atende desta empresa</b><span style={{ fontSize: 12, color: c.muted }}>Para {triedSms!.to} · pelo telemóvel BASECOM</span></div>
          <textarea aria-label="Texto da SMS" style={{ ...input, height: 110, padding: 10, resize: "vertical", lineHeight: "20px" }} value={smsText} onChange={(e) => setSmsText(e.target.value)} />
          <span style={{ fontSize: 12, color: c.muted }}>Pode alterar o texto. O modelo muda-se em Configurações → Mensagens rápidas.</span>
        </div>
      )}
      {!workKind && <Field label={reason?.effect === "other" ? "Comentários (obrigatório no motivo «Outro»)" : "Comentários"}>
        <textarea style={{ ...input, height: 64, padding: 10, resize: "vertical" }} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>}

      {askKind && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", background: c.warnSoft, borderRadius: 10 }}>
          <b style={{ fontSize: 13 }}>Cliente NOS sem NC/FC: identifique (obrigatório)</b>
          {(["NC", "FC", "NN"] as const).map((k) => <button key={k} style={pill(kind === k)} onClick={() => setKind(k)}>{k}</button>)}
          {kind === "NN" && <span style={{ fontSize: 12, color: c.muted }}>Já não é cliente NOS: passa a ex-cliente (sai da base de clientes atuais).</span>}
        </div>
      )}

      {!byOperator && !workKind && <details>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Feedback de outra operadora</summary>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
          <Field label="Operadora atual"><div style={{ display: "flex", gap: 4 }}>{OPERATORS.map((o) => <button key={o} style={{ ...pill(comp.operator === o), height: 30, fontSize: 12 }} onClick={() => setComp({ ...comp, operator: comp.operator === o ? undefined : o })}>{o}</button>)}</div></Field>
          <Field label="Fim de fidelização"><DatePicker value={date} onChange={setDate} width={180} ariaLabel="Fim de fidelização" /></Field>
        </div>
        <Field label="O que diz da operadora atual"><input style={{ ...input, marginTop: 6 }} value={comp.text ?? ""} onChange={(e) => setComp({ ...comp, text: e.target.value || undefined })} placeholder="Ex.: paga 120 €/mês por 4 linhas e internet" /></Field>
      </details>}
      {byOperator && <Field label="O que diz da operadora atual"><input style={input} value={comp.text ?? ""} onChange={(e) => setComp({ ...comp, text: e.target.value || undefined })} placeholder="Ex.: paga 120 €/mês por 4 linhas e internet" /></Field>}

      <ErrorText>{error}</ErrorText>
      <footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
        <button style={btn} onClick={onBack}>← {backLabel ?? "Voltar ao script"}</button>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {live && <button style={{ ...btnDark, height: 44, background: "#D70015", borderColor: "#D70015" }} onClick={live.onHangUp}>Desligar</button>}
          {showSms && !live && <button style={{ ...btn, height: 44 }} disabled={!ready || busy} onClick={() => save(false)}>Guardar sem SMS</button>}
          <button style={{ ...btnDark, height: 44, padding: "0 22px" }} disabled={!ready || busy} onClick={() => save(showSms && !!smsText.trim())}>{busy ? "A guardar…" : showSms && smsText.trim() ? `${live ? "Desligar · " : ""}Não atende + SMS ⏎` : live ? "Desligar e guardar ⏎" : workKind ? `Começar ${workKind === "sale" ? "venda" : "proposta"} · fica em pausa ⏎` : "Guardar resultado ⏎"}</button>
        </span>
      </footer>
    </section>
  );
}
