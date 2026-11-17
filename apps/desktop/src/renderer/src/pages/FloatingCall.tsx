import { createPortal } from "react-dom";
import { c } from "../ui";

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Cartão de chamada flutuante (desenho 13): aparece em todas as páginas fora do Ligar enquanto há uma chamada
 * ou um resultado por registar. Mute, Voltar (ao Ligar) e Desligar.
 */
export function FloatingCall({ company, phone, secs, muted, canMute, onMute, onBack, onHangUp, pending }: {
  company: string; phone?: string; secs: number; muted: boolean; canMute: boolean;
  onMute: () => void; onBack: () => void; onHangUp: () => void;
  /** Chamada terminada, resultado por registar: segundos que faltam (podem ser negativos). */
  pending?: { left: number };
}) {
  const box = { position: "fixed" as const, right: 24, bottom: 24, zIndex: 70, width: 360, borderRadius: 18, boxShadow: "0 18px 44px rgba(0,0,0,.28)", padding: 16, display: "flex", flexDirection: "column" as const, gap: 12, fontFamily: "inherit" };
  const dark = { height: 40, borderRadius: 10, border: "1px solid #3A3A3C", background: "#1C1C1E", color: "#FFFFFF", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" };
  if (pending) return createPortal(
    <div role="status" aria-label="Resultado por registar" style={{ ...box, background: c.card, border: `2px solid ${c.brand}`, color: c.ink, flexDirection: "row", alignItems: "center" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>Falta registar o resultado</b>
        <span style={{ fontSize: 12, color: c.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{company} · chamada terminada</span>
      </div>
      <span style={{ fontSize: 18, fontWeight: 800, color: pending.left < 0 ? "#D70015" : c.brand, fontVariantNumeric: "tabular-nums" }}>{pending.left} s</span>
      <button onClick={onBack} style={{ height: 38, padding: "0 14px", border: 0, borderRadius: 10, background: c.ink, color: c.onInk, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Registar</button>
    </div>, document.body);
  return createPortal(
    <div role="dialog" aria-label="Chamada em curso" style={{ ...box, background: "#0B0B0B", color: "#FFFFFF" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 999, background: muted ? "#FF5A00" : "#1F8A4C", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 44px" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
        </span>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{company}</b>
          <span style={{ fontSize: 12, color: "#B8B8BD" }}>{muted ? "Mute ligado · o cliente não o ouve" : phone ?? "Em chamada"}</span>
        </div>
        <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{mmss(secs)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: canMute ? "1fr 1fr 1.2fr" : "1fr 1.2fr", gap: 8 }}>
        {canMute && <button onClick={onMute} aria-pressed={muted} style={{ ...dark, ...(muted ? { background: "#FF5A00", borderColor: "#FF5A00" } : {}) }}>{muted ? "Tirar mute" : "Mute"}</button>}
        <button onClick={onBack} style={dark}>Voltar</button>
        <button onClick={onHangUp} style={{ ...dark, border: 0, background: "#D70015", fontWeight: 800 }}>Desligar</button>
      </div>
    </div>, document.body);
}

/** Mute no telemóvel BASECOM (o estado volta a desligado em cada chamada nova). */
export function MuteButton({ muted, onClick, height = 48 }: { muted: boolean; onClick: () => void; height?: number }) {
  return <button onClick={onClick} aria-pressed={muted} style={{ height, padding: "0 16px", borderRadius: 10, border: `1px solid ${muted ? c.brand : c.line}`, background: muted ? c.brand : c.card, color: muted ? "#FFFFFF" : c.ink, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{muted ? "Tirar mute" : "Mute"}</button>;
}
