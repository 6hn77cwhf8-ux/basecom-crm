import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { btn, btnDark, c } from "../ui";
import { overlay } from "../overlay";

const REASONS = ["Cliente quer falar com responsável", "Dúvida na proposta", "Problema técnico", "Outro"];

/** Som curto para o alerta de ajuda (no computador do Chefe de Equipa). */
function ding() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((d) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = 988; g.gain.value = 0.09;
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.25); o.stop(ctx.currentTime + d + 0.3);
    });
  } catch { /* sem som */ }
}

/**
 * Botão laranja «Pedir ajuda» (desenho aprovado a 26/11), por cima de «Terminar sessão», sempre visível — também em chamada.
 * Motivo rápido opcional; depois «À espera do CE…» e «O X vem aí».
 */
export function HelpButton({ open }: { open: boolean }) {
  const [asking, setAsking] = useState(false);
  const [req, setReq] = useState<{ id: string; at: number } | null>(null);
  const [acked, setAcked] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!req || acked) return;
    const t = setInterval(() => { tick((x) => x + 1); api.helpStatus(req.id).then((s) => { if (s.acked) setAcked(s.text ?? "O Chefe de Equipa vem aí"); }).catch(() => undefined); }, 4000);
    return () => clearInterval(t);
  }, [req?.id, acked]);
  useEffect(() => { if (!acked) return; const t = setTimeout(() => { setReq(null); setAcked(null); }, 60_000); return () => clearTimeout(t); }, [acked]);
  const send = (reason?: string) => {
    setAsking(false); setAcked(null);
    api.requestHelp({ companyId: document.body.dataset.callCompanyId || null, reason: reason ?? null }).then((r) => setReq({ id: r.id, at: Date.now() })).catch(() => undefined);
  };
  const secs = req ? Math.floor((Date.now() - req.at) / 1000) : 0;
  return (
    <div style={{ position: "relative", marginBottom: 8 }}>
      {req && open && (acked
        ? <div role="status" style={{ marginBottom: 6, borderRadius: 10, background: c.okSoft, color: c.ok, padding: "8px 10px", fontSize: 13, fontWeight: 700 }}>{acked.replace(/ vem aí$/, "")} vem aí</div>
        : <div role="status" style={{ marginBottom: 6, borderRadius: 10, background: "#FFF4ED", color: "#9A3412", padding: "8px 10px", fontSize: 12, fontWeight: 600 }}>À espera do CE… {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} · <button onClick={() => setReq(null)} style={{ border: 0, background: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>Cancelar</button></div>)}
      <button type="button" onClick={() => setAsking(!asking)} title="Pedir ajuda ao Chefe de Equipa" aria-label="Pedir ajuda"
        style={{ width: "100%", height: open ? 40 : 34, borderRadius: 12, border: "2px solid #C2410C", background: "#FFF4ED", color: "#9A3412", fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>{open ? "Pedir ajuda" : "?"}</button>
      {asking && (
        <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 6, zIndex: 70, width: 260, background: c.card, border: `1px solid ${c.line}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,.18)", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <b style={{ fontSize: 13 }}>Pedir ajuda · motivo (opcional)</b>
          {REASONS.map((r) => <button key={r} style={{ ...btn, height: 34, fontSize: 12, textAlign: "left" }} onClick={() => send(r)}>{r}</button>)}
          <button style={{ ...btnDark, height: 36, fontSize: 13, background: "#C2410C", borderColor: "#C2410C" }} onClick={() => send()}>Enviar já</button>
        </div>
      )}
    </div>
  );
}

/** Chefe de Equipa / Administrador: alerta de ajuda (no CRM e por cima de todas as aplicações), com som. */
export function HelpAlerts({ onOpenCompany }: { onOpenCompany: (id: string) => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.helpPending>>>([]);
  const seen = useRef(new Set<string>());
  const first = items[0];
  const firstRef = useRef(first); firstRef.current = first;
  useEffect(() => {
    const load = () => api.helpPending().then(setItems).catch(() => undefined);
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (first && !seen.current.has(first.id)) { seen.current.add(first.id); ding(); }
    if (!overlay) return;
    if (!first) { overlay.hide("help"); return; }
    overlay.show("help", { tone: "orange", subtitle: "Pedido de ajuda", title: first.from ? `${first.from} pede ajuda` : "Pedido de ajuda", lines: [first.text.replace(/^[^·]+· ?/, "")],
      buttons: [{ id: "ack", label: "Vou já", kind: "primary" }, ...(first.companyId ? [{ id: "open", label: "Abrir ficha" }] : [])] });
  }, [first?.id]);
  const ack = (id: string) => api.helpAck(id).then(() => setItems((l) => l.filter((x) => x.id !== id))).catch(() => undefined);
  useEffect(() => overlay?.onAction((kind, action) => {
    const f = firstRef.current; if (kind !== "help" || !f) return;
    if (action === "ack") ack(f.id);
    if (action === "open" && f.companyId) onOpenCompany(f.companyId);
  }), []);
  if (!first) return null;
  return (
    <div role="alertdialog" aria-label="Pedido de ajuda" style={{ position: "fixed", right: 24, top: 80, zIndex: 125, width: 360, background: c.card, border: "2px solid #C2410C", borderRadius: 16, boxShadow: "0 18px 44px rgba(0,0,0,.28)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <b style={{ fontSize: 16 }}>{first.from ? `${first.from} pede ajuda` : "Pedido de ajuda"}</b>
      <span style={{ fontSize: 13, background: "#FFF4ED", borderRadius: 10, padding: "8px 10px" }}>{first.text}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ ...btnDark, flex: 1, height: 44 }} onClick={() => ack(first.id)}>Vou já</button>
        {first.companyId && <button style={{ ...btn, flex: 1, height: 44 }} onClick={() => onOpenCompany(first.companyId!)}>Abrir ficha</button>}
      </div>
      {items.length > 1 && <span style={{ fontSize: 12, color: c.muted }}>Mais {items.length - 1} pedido(s) à espera.</span>}
    </div>
  );
}
