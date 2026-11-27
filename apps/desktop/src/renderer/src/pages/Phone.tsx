import { useEffect, useRef, useState } from "react";
import { formatPhone } from "@basecom/shared";
import { api, INCOMING_DISMISS, INCOMING_EVENT, OPEN_SCRIPT_EVENT, openScript as openScriptFor, type Incoming, type PhoneDevice, type SearchHit } from "../api";
import { QuickCall } from "./QuickCall";
import { overlay } from "../overlay";
import { btn, btnDark, c, ErrorText } from "../ui";
import { Modal } from "./Wallet";

/** Estado do telemóvel emparelhado (app BASECOM), atualizado a cada 30 s. */
export function usePhone() {
  const [device, setDevice] = useState<PhoneDevice | null | undefined>(undefined);
  const load = () => api.myDevice().then(setDevice).catch(() => setDevice(null));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);
  return { device, reload: load };
}

/**
 * Quando a chamada é feita pelo telemóvel, o fim chega sozinho: chama onEnd com a hora do fim e se foi atendida
 * (duração > 0). Pergunta ao CRM a cada 2 segundos enquanto a chamada está aberta.
 */
export function useCallEnd(callId: string | null, active: boolean, onEnd: (endedAt: number, answered: boolean | null) => void) {
  const cb = useRef(onEnd);
  cb.current = onEnd;
  useEffect(() => {
    if (!callId || !active) return;
    let stop = false;
    const t = setInterval(() => {
      api.callStatus(callId).then((s) => { if (!stop && s.endedAt && s.via === "app") { stop = true; cb.current(new Date(s.endedAt).getTime(), s.answered); } }).catch(() => undefined);
    }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [callId, active]);
}

/** Emparelhar o telemóvel: código de 6 algarismos para escrever na app BASECOM. */
export function PhoneDialog({ onClose }: { onClose: () => void }) {
  const { device, reload } = usePhone();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { if (!code) return; const t = setInterval(reload, 3000); return () => clearInterval(t); }, [code]);
  const fresh = device && code && new Date(device.pairedAt).getTime() > Date.now() - 10 * 60_000;
  return (
    <Modal title="Telemóvel" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
        {device ? (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: device.online ? c.okSoft : c.warnSoft, color: device.online ? c.ok : c.warn }}>
            <b>{device.online ? "Ligado" : "Emparelhado, mas sem sinal"}</b> · {device.model ?? "Telemóvel"}{device.lastSeenAt ? ` · último sinal ${new Date(device.lastSeenAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}` : ""}
            {!device.online && <div style={{ fontSize: 13, marginTop: 4 }}>Abra a app BASECOM no telemóvel e confirme que tem internet e que a app está «sem restrições de bateria».</div>}
          </div>
        ) : <span style={{ color: c.muted }}>Ainda não há telemóvel emparelhado. Sem ele, marca à mão e usa os botões «Iniciar chamada» e «Desligar».</span>}
        {fresh && <b style={{ color: c.ok }}>Emparelhado com sucesso.</b>}
        <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>Instale a app BASECOM no telemóvel (ficheiro APK enviado pelo Administrador).</li>
          <li>Abra a app e escreva o código abaixo.</li>
          <li>Dê as autorizações que a app pedir e escolha «Sem restrições de bateria».</li>
        </ol>
        {code ? (
          <div style={{ textAlign: "center", padding: 12, border: `1px solid ${c.line}`, borderRadius: 12 }}>
            <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 8, fontVariantNumeric: "tabular-nums" }}>{code.code}</div>
            <div style={{ fontSize: 12, color: c.muted }}>Válido até às {new Date(code.expiresAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        ) : <button style={btnDark} onClick={() => api.pairCode().then(setCode).catch((e) => setErr(e.message))}>{device ? "Emparelhar outro telemóvel" : "Gerar código"}</button>}
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {device ? <button style={{ ...btn, color: c.danger }} onClick={() => confirm("Desligar este telemóvel do CRM?") && api.unpairDevice().then(reload).catch((e) => setErr(e.message))}>Desemparelhar</button> : <span />}
          <button style={btn} onClick={onClose}>Fechar</button>
        </div>
      </div>
    </Modal>
  );
}

/** Aviso «Chamada a entrar» (maqueta 9): número, empresa, carteira e tarefas abertas, com «Abrir ficha». */
export function IncomingBanner({ onOpenCompany, bigScript = true }: { onOpenCompany: (id: string) => void; bigScript?: boolean }) {
  const [inc, setInc] = useState<Incoming | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Chamada atendida: janela da chamada (desenho 17), que fica aberta até guardar o resultado.
  const [answered, setAnswered] = useState<Incoming | null>(null);
  useEffect(() => {
    const load = () => api.incoming().then(setInc).catch(() => undefined);
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (inc?.answeredAt && inc.id !== dismissed && answered?.id !== inc.id) setAnswered(inc); }, [inc?.id, inc?.answeredAt]);
  // Avisa o Ligar (18 nov): há uma chamada recebida a tocar ou aberta — não marca a seguinte e, se estiver a meio de uma, pergunta.
  const active = !!answered || (!!inc && inc.id !== dismissed && !inc.endedAt);
  useEffect(() => {
    // 24 nov: vai também o número e TODAS as empresas desse número (um número pode estar em várias empresas).
    const x = answered ?? inc;
    window.dispatchEvent(new CustomEvent(INCOMING_EVENT, { detail: { active, open: !!answered, id: x?.id ?? null, who: x ? (x.companies.length > 1 ? x.companies.map((k) => k.name).join(" / ") : x.company ?? x.number) : null, number: x?.number ?? null, companyIds: x?.companies.map((k) => k.id) ?? (x?.companyId ? [x.companyId] : []) } }));
  }, [active, !!answered, answered?.id, inc?.id]);
  // O Ligar decidiu continuar a sua chamada: fecha a janela da recebida.
  useEffect(() => {
    const h = (e: Event) => { const id = (e as CustomEvent<string>).detail; setDismissed(id); setAnswered((a) => (a?.id === id ? null : a)); };
    window.addEventListener(INCOMING_DISMISS, h);
    return () => window.removeEventListener(INCOMING_DISMISS, h);
  }, []);
  // 26 nov: a chamada a entrar também aparece por cima de todas as aplicações (programa do computador 0.16+).
  const ringing = !answered && !!inc && inc.id !== dismissed && !inc.endedAt ? inc : null;
  // 27 nov: «Atender e abrir script» atende no telemóvel (pelo CRM) e abre o script grande da empresa que está a ligar.
  const openScript = (x: Incoming, answer = true) => {
    if (answer && !x.answeredAt) api.phoneAnswer().catch(() => undefined);
    if (bigScript && x.companies.length === 1) { openScriptFor({ companyId: x.companies[0]!.id, number: x.number }); setDismissed(x.id); }
    else setAnswered(x);
  };
  const openRef = useRef(openScript); openRef.current = openScript;
  // 27 nov: com o CRM à frente usa-se só a caixa do CRM; a de cima de tudo só quando o CRM está atrás ou minimizado.
  const [front, setFront] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFront(true), off = () => setFront(false);
    window.addEventListener("focus", on); window.addEventListener("blur", off);
    return () => { window.removeEventListener("focus", on); window.removeEventListener("blur", off); };
  }, []);
  const ringRef = useRef(ringing); ringRef.current = ringing;
  useEffect(() => {
    if (!overlay) return;
    if (!ringing || front) { overlay.hide("incoming"); return; }
    const num = /^\d{9}$/.test(ringing.number) ? formatPhone(ringing.number) : ringing.number;
    overlay.show("incoming", { tone: "green", subtitle: "Chamada a entrar", title: ringing.companies.length > 1 ? `${ringing.companies.length} empresas com este número` : ringing.company ?? "Número desconhecido",
      lines: [`${num}${ringing.owner ? ` · carteira de ${ringing.owner}` : ""}`], buttons: [{ id: "script", label: "Atender e abrir script", kind: "primary" }, { id: "ignore", label: "Não atender" }] });
  }, [ringing?.id, front]);
  useEffect(() => overlay?.onAction((kind, action) => {
    const r = ringRef.current;
    if (kind !== "incoming" || !r) return;
    if (action === "answer" || action === "script") openRef.current(r); else if (action === "ignore") setDismissed(r.id);
  }), []);
  if (answered) return <IncomingCall bigScript={bigScript} inc={answered} onDone={() => { setDismissed(answered.id); setAnswered(null); }} />;
  if (!inc || inc.id === dismissed) return null;
  return (
    <div role="alert" style={{ position: "fixed", right: 24, top: 20, zIndex: 60, width: 380, background: c.card, border: `2px solid ${c.brand}`, borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,.18)", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: c.brand }}>Chamada a entrar</span>
      <b style={{ fontSize: 16 }}>{inc.companies.length > 1 ? `${inc.companies.length} empresas com este número` : inc.company ?? "Número desconhecido"}</b>
      <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{/^\d{9}$/.test(inc.number) ? formatPhone(inc.number) : inc.number}{inc.owner ? ` · carteira de ${inc.owner}` : ""}{inc.companyId ? ` · ${inc.openTasks} tarefa(s) aberta(s)` : ""}</span>
      <span style={{ fontSize: 12, color: c.muted }}>Ao atender no telemóvel, abre a janela da chamada.</span>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button style={{ ...btnDark, height: 32, fontSize: 13 }} onClick={() => openScript(inc)}>Atender e abrir script</button>
        {inc.companyId && <button style={{ ...btn, height: 32, fontSize: 13 }} onClick={() => { onOpenCompany(inc.companyId!); }}>Abrir ficha</button>}
        <button style={{ ...btn, height: 32, fontSize: 13 }} onClick={() => setDismissed(inc.id)}>Fechar</button>
      </div>
    </div>
  );
}

/** Chamada recebida atendida: escolher a empresa (se houver várias ou nenhuma) e abrir a janela de chamada. */
function IncomingCall({ inc, onDone, bigScript }: { inc: Incoming; onDone: () => void; bigScript?: boolean }) {
  const [co, setCo] = useState<{ id: string; name: string; nif: string } | null>(inc.companies.length === 1 ? inc.companies[0]! : null);
  const [info, setInfo] = useState<{ walletKind?: "NC" | "FC"; needsKind: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!co) return;
    api.company(co.id).then((d) => setInfo({ walletKind: d.company.walletKind as "NC" | "FC" | undefined, needsKind: d.company.accountType === "client" && !d.company.ownerId && !d.company.walletKindConfirmed })).catch(() => setInfo({ needsKind: false }));
  }, [co?.id]);
  useEffect(() => {
    if (co || q.trim().length < 3) { setHits([]); return; }
    const t = setTimeout(() => api.search(q.trim()).then((r) => setHits(r.slice(0, 6))).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, co]);
  const num = /^\d{9}$/.test(inc.number) ? formatPhone(inc.number) : inc.number;
  // 27 nov: comercial e Chefe de Equipa: escolhida a empresa, abre o script grande no Ligar (nunca a janela pequena).
  useEffect(() => { if (co && bigScript) { openScriptFor({ companyId: co.id, number: inc.number }); onDone(); } }, [co?.id]);
  if (co && bigScript) return null;
  if (co && info) return <QuickCall received company={{ ...co, walletKind: info.walletKind }} contact={{ value: inc.number }} needsKind={info.needsKind} onClose={onDone} onSaved={onDone} />;
  return (
    <Modal title={`Chamada recebida · ${num}`} onClose={onDone} width={620}>
      {inc.companies.length > 1 ? <>
        <b style={{ fontSize: 14 }}>Este número está em {inc.companies.length} empresas. Escolha de qual é:</b>
        {inc.companies.map((x) => <button key={x.id} style={{ ...btn, height: "auto", padding: "10px 12px", display: "flex", justifyContent: "space-between", textAlign: "left" }} onClick={() => setCo(x)}><b>{x.name}</b><span style={{ color: c.muted, fontWeight: 400 }}>NIF {x.nif}</span></button>)}
      </> : <>
        <span style={{ fontSize: 14 }}><b>Número desconhecido.</b> Pesquise a empresa (NIF ou nome) para registar o resultado.</span>
        <input style={{ height: 40, border: `1px solid ${c.line}`, borderRadius: 10, padding: "0 12px", fontFamily: "inherit", fontSize: 14, background: c.card, color: c.ink }} autoFocus placeholder="NIF ou nome (3 caracteres ou mais)" value={q} onChange={(e) => setQ(e.target.value)} />
        {hits.map((h) => <button key={h.id} style={{ ...btn, height: "auto", padding: "10px 12px", display: "flex", justifyContent: "space-between", textAlign: "left" }} onClick={() => setCo({ id: h.id, name: h.name, nif: h.nif })}><b>{h.name}</b><span style={{ color: c.muted, fontWeight: 400 }}>NIF {h.nif}</span></button>)}
      </>}
      <div style={{ display: "flex", justifyContent: "flex-end" }}><button style={btn} onClick={onDone}>Fechar sem registar</button></div>
    </Modal>
  );
}
