import { useEffect, useState } from "react";
import { DEFAULT_SIGNATURE, renderSignature } from "@basecom/shared";
import { api } from "../api";
import { btn, btnDark, c, ErrorText, input } from "../ui";
import { Modal } from "./Wallet";

/**
 * Assinatura das mensagens (19 nov): cargo, telemóvel e email profissional, como no cartão de visita.
 * Vai no fim do WhatsApp e do email (não na SMS «Tentámos ligar»). A própria pessoa ou o Administrador alteram.
 */
export function SignatureDialog({ user, onClose, onDone }: { user: { id: string; name: string; email: string; jobTitle?: string | null; mobile?: string | null; workEmail?: string | null }; onClose: () => void; onDone: () => void }) {
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? "");
  const [mobile, setMobile] = useState(user.mobile ?? "");
  const [workEmail, setWorkEmail] = useState(user.workEmail ?? "");
  const [tpl, setTpl] = useState(DEFAULT_SIGNATURE);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // O modelo da assinatura é do Administrador (Configurações → Mensagens rápidas); os outros veem o modelo por omissão.
  useEffect(() => { api.settings().then((s) => { const v = (s.messages as { signature?: string }).signature; if (v) setTpl(v); }).catch(() => undefined); }, []);
  const preview = renderSignature(tpl, { comercial: user.name, cargo: jobTitle.trim() || null, telemovel: mobile.trim() || null, email: workEmail.trim() || user.email });
  const field = (label: string, v: string, set: (x: string) => void, ph: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>{label}
      <input style={input} value={v} onChange={(e) => set(e.target.value)} placeholder={ph} /></label>
  );
  return (
    <Modal title={`Assinatura · ${user.name}`} onClose={onClose} width={560}>
      <span style={{ fontSize: 13, color: c.muted }}>Vai no fim das mensagens de WhatsApp e de email, como no cartão de visita.</span>
      {field("Cargo", jobTitle, setJobTitle, "Ex.: Consultora Comercial")}
      {field("Telemóvel", mobile, setMobile, "Ex.: 931 045 933")}
      {field("Email profissional", workEmail, setWorkEmail, "Ex.: nome@basecom.pt")}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <b style={{ fontSize: 13 }}>Pré-visualização</b>
        <pre style={{ margin: 0, padding: 12, borderRadius: 10, background: c.sunken, fontFamily: "inherit", fontSize: 13, lineHeight: "20px", whiteSpace: "pre-wrap" }}>{preview ?? "Sem cargo nem telemóvel: as mensagens vão sem assinatura."}</pre>
      </div>
      <ErrorText>{err}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={btn} onClick={onClose}>Cancelar</button>
        <button style={btnDark} disabled={busy} onClick={() => { setBusy(true); setErr(""); api.setProfile(user.id, { jobTitle: jobTitle.trim() || null, mobile: mobile.trim() || null, workEmail: workEmail.trim() || null }).then(onDone).catch((e) => setErr(e.message)).finally(() => setBusy(false)); }}>Guardar</button>
      </div>
    </Modal>
  );
}
