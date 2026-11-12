import { useEffect, useRef, useState } from "react";
import { formatPhone } from "@basecom/shared";
import { api, type Incoming, type PhoneDevice } from "../api";
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
          <div style={{ padding: "10px 12px", borderRadius: 10, background: device.online ? "#E8F5EC" : "#FFF4E5", color: device.online ? "#1E6F33" : "#8A3D00" }}>
            <b>{device.online ? "Ligado" : "Emparelhado, mas sem sinal"}</b> · {device.model ?? "Telemóvel"}{device.lastSeenAt ? ` · último sinal ${new Date(device.lastSeenAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}` : ""}
            {!device.online && <div style={{ fontSize: 13, marginTop: 4 }}>Abra a app BASECOM no telemóvel e confirme que tem internet e que a app está «sem restrições de bateria».</div>}
          </div>
        ) : <span style={{ color: c.muted }}>Ainda não há telemóvel emparelhado. Sem ele, marca à mão e usa os botões «Iniciar chamada» e «Desligar».</span>}
        {fresh && <b style={{ color: "#1E6F33" }}>Emparelhado com sucesso.</b>}
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
          {device ? <button style={{ ...btn, color: "#A1000F" }} onClick={() => confirm("Desligar este telemóvel do CRM?") && api.unpairDevice().then(reload).catch((e) => setErr(e.message))}>Desemparelhar</button> : <span />}
          <button style={btn} onClick={onClose}>Fechar</button>
        </div>
      </div>
    </Modal>
  );
}

/** Aviso «Chamada a entrar» (maqueta 9): número, empresa, carteira e tarefas abertas, com «Abrir ficha». */
export function IncomingBanner({ onOpenCompany }: { onOpenCompany: (id: string) => void }) {
  const [inc, setInc] = useState<Incoming | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.incoming().then(setInc).catch(() => undefined);
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  if (!inc || inc.id === dismissed) return null;
  const ringing = !inc.endedAt;
  return (
    <div role="alert" style={{ position: "fixed", right: 24, top: 20, zIndex: 60, width: 380, background: c.card, border: `2px solid ${ringing ? c.brand : c.line}`, borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,.18)", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: ringing ? c.brand : c.muted }}>{ringing ? "Chamada a entrar" : "Chamada recebida"}</span>
      <b style={{ fontSize: 16 }}>{inc.company ?? "Número desconhecido"}</b>
      <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{/^\d{9}$/.test(inc.number) ? formatPhone(inc.number) : inc.number}{inc.owner ? ` · carteira de ${inc.owner}` : ""}{inc.companyId ? ` · ${inc.openTasks} tarefa(s) aberta(s)` : ""}</span>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {inc.companyId && <button style={{ ...btnDark, height: 32, fontSize: 13 }} onClick={() => { onOpenCompany(inc.companyId!); setDismissed(inc.id); }}>Abrir ficha</button>}
        <button style={{ ...btn, height: 32, fontSize: 13 }} onClick={() => setDismissed(inc.id)}>Fechar</button>
      </div>
    </div>
  );
}
