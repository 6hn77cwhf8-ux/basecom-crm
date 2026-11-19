import { useEffect, useMemo, useState } from "react";
import { formatPhone, renderMessage } from "@basecom/shared";
import { api, type CompanyDetail } from "../api";
import { btn, btnDark, c, ErrorText, input } from "../ui";
import { Modal } from "./Wallet";

type Channel = "whatsapp" | "sms" | "email";
const CHANNELS: [Channel, string][] = [["whatsapp", "WhatsApp"], ["sms", "SMS"], ["email", "Email"]];

/**
 * Mensagem rápida (desenho 10, 17 nov): modelo com o nome do decisor, a empresa, a OP e o comercial.
 * WhatsApp abre o WhatsApp do computador (ou o WhatsApp Web) com o texto; Email abre o programa de email;
 * SMS abre a mensagem no telemóvel BASECOM emparelhado. Quem envia é sempre o comercial. Fica no histórico.
 */
export function MessageDialog({ companyId, me, initialTemplate, onClose, onSent }: { companyId: string; me: { name: string; mobile?: string | null }; initialTemplate?: string; onClose: () => void; onSent?: () => void }) {
  const [d, setD] = useState<CompanyDetail | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ id: string; label: string; text: string }[]>([]);
  // Assinatura do comercial (19 nov): no WhatsApp e no email, igual ao cartão de visita.
  const [signature, setSignature] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [tpl, setTpl] = useState(initialTemplate ?? "");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    Promise.all([api.company(companyId), api.messageKit(), api.companyOpportunities(companyId)]).then(([cd, kit, opps]) => {
      const t = kit.templates;
      setD(cd); setTemplates(t); setSignature(kit.signature);
      setOp(opps.find((o) => !o.closedAt && o.nosOp)?.nosOp ?? null);
      // «Tentámos ligar» é a SMS do 1.º não atende: não é o modelo por omissão aqui.
      const first = t.find((x) => x.id !== "tried_call") ?? t[0];
      if (!initialTemplate && first) setTpl(first.id);
    }).catch((e) => setErr(e.message));
  }, [companyId]);

  const decisor = d?.contacts.find((x) => x.isPrimary && x.personName) ?? d?.contacts.find((x) => x.personName);
  const vars = { decisor: decisor ? `${decisor.salutation ? decisor.salutation + " " : ""}${decisor.personName}` : undefined, empresa: d?.company.name, op: op ?? undefined, comercial: me.name, telemovel: me.mobile ?? undefined };
  // Destinos: WhatsApp e SMS só para telemóveis; email só para emails válidos.
  const options = useMemo(() => (d?.contacts ?? []).filter((x) => x.status !== "incorrect" && (channel === "email" ? x.kind === "email" : x.kind === "phone" && /^9/.test(x.value))), [d, channel]);
  useEffect(() => { setTo(options.find((x) => x.isPrimary)?.value ?? options[0]?.value ?? ""); }, [options]);
  useEffect(() => {
    const t = templates.find((x) => x.id === tpl);
    if (t && d) setText(renderMessage(t.text, vars) + (signature && channel !== "sms" && t.id !== "tried_call" ? `\n\n${signature}` : ""));
  }, [tpl, templates, d, op, signature, channel]);

  const label = (v: string) => { const x = options.find((o) => o.value === v); return `${channel === "email" ? v : formatPhone(v)}${x?.personName ? ` · ${x.salutation ? x.salutation + " " : ""}${x.personName}` : ""}`; };
  async function send() {
    setErr(""); setDone("");
    try {
      if (channel === "whatsapp") window.open(`https://wa.me/351${to}?text=${encodeURIComponent(text)}`);
      if (channel === "email") {
        const subject = `${templates.find((x) => x.id === tpl)?.label ?? "Mensagem"} · ${d?.company.name ?? ""}`;
        window.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`);
      }
      await api.logMessage(companyId, { channel, templateId: tpl || undefined, to, text });
      setDone(channel === "sms" ? "Enviado para o telemóvel: abra a mensagem no telemóvel e carregue em enviar." : "Aberto. Fica registado no histórico da empresa.");
      onSent?.();
    } catch (e) { setErr((e as Error).message); }
  }
  const pill = (on: boolean) => ({ ...btn, height: 34, fontSize: 13, background: on ? c.ink : c.card, color: on ? c.onInk : c.ink, borderColor: on ? c.ink : c.line });

  return (
    <Modal title={`Mensagem · ${d?.company.name ?? "…"}`} onClose={onClose} width={680}>
      <div role="group" aria-label="Canal" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 12, background: c.surface, alignSelf: "flex-start" }}>
        {CHANNELS.map(([k, l]) => <button key={k} type="button" onClick={() => setChannel(k)} style={{ border: 0, height: 32, padding: "0 14px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: channel === k ? 700 : 500, background: channel === k ? c.card : "transparent", color: channel === k ? c.ink : c.muted }}>{l}</button>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Modelo</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{templates.map((t) => <button key={t.id} type="button" style={pill(tpl === t.id)} onClick={() => setTpl(t.id)}>{t.label}</button>)}</div>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>Para
        {options.length ? (
          <select style={input} value={to} onChange={(e) => setTo(e.target.value)}>{options.map((o) => <option key={o.id} value={o.value}>{label(o.value)}</option>)}</select>
        ) : <span style={{ fontWeight: 400, color: c.muted }}>{channel === "email" ? "Esta empresa não tem email registado." : "Esta empresa não tem telemóvel registado (o WhatsApp e a SMS não funcionam em fixos)."}</span>}
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>Texto (pode alterar antes de enviar)
        <textarea style={{ ...input, minHeight: 150, padding: "10px 12px", lineHeight: "21px", fontWeight: 400, resize: "vertical" }} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {done && <span role="status" style={{ fontSize: 13, color: c.ok, fontWeight: 600 }}>{done}</span>}
      <ErrorText>{err}</ErrorText>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" style={btn} onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}>{copied ? "Copiado ✓" : "Copiar texto"}</button>
        <button type="button" style={btnDark} disabled={!to || text.trim().length < 2} onClick={send}>{channel === "whatsapp" ? "Abrir no WhatsApp" : channel === "sms" ? "Enviar para o telemóvel" : "Abrir no email"}</button>
      </div>
    </Modal>
  );
}
