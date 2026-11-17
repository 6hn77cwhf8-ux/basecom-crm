import { useEffect, useState } from "react";
import { api, WORK_EVENT, type DaySummary, type Role, type WorkState } from "../api";
import { c } from "../ui";
import { StartClientDialog } from "./ClientWork";

export const STATE_LABEL: Record<WorkState, string> = {
  working: "A trabalhar", training: "Formação", break: "Intervalo", switch: "Mudança de campanha",
  office: "Office", client: "Em cliente", support: "Apoio",
};
export const mmss = (s: number) => `${s < 0 ? "-" : ""}${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`;
const LEADS: Role[] = ["admin", "team_lead"];

/**
 * Estados (decisões de 16 nov 2026).
 * Comercial: A trabalhar · Office (limite do dia; no fim passa sozinho a A trabalhar) · Intervalo · + Em cliente.
 * Chefe de Equipa e Administrador: A trabalhar · Apoio (sem limite) · Formação · Intervalo · + Em cliente.
 * Fora de «A trabalhar» não são marcadas chamadas.
 */
export function WorkStates({ role, onChange, disabled }: { role: Role; onChange?: (s: DaySummary) => void; disabled?: boolean }) {
  const [d, setD] = useState<DaySummary | null>(null);
  const [at, setAt] = useState(Date.now());
  const [starting, setStarting] = useState(false);
  const apply = (x: DaySummary) => { setD(x); setAt(Date.now()); onChange?.(x); };
  const load = () => api.today().then(apply).catch(() => undefined);
  // Volta a ler logo a seguir ao primeiro sinal de presença (ao entrar, o estado ainda pode não existir).
  useEffect(() => {
    load(); const first = setTimeout(load, 2500); const t = setInterval(load, 30_000);
    window.addEventListener(WORK_EVENT, load);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener(WORK_EVENT, load); };
  }, []);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const extra = d ? Math.floor((Date.now() - at) / 1000) : 0;
  const live = (s: WorkState) => (d?.state === s ? extra : 0);
  const officeLeft = d ? d.limits.officeSeconds - d.seconds.office - live("office") : 1;
  // Office no limite: o tempo fecha e passa sozinho a «A trabalhar».
  useEffect(() => { if (d?.state === "office" && officeLeft <= 0) api.setWorkState("working").then(apply).catch(() => undefined); }, [d?.state, officeLeft <= 0]);
  if (!d) return null;
  const breakLeft = d.limits.breakSeconds - d.used.break - live("break");
  const lead = LEADS.includes(role);
  const inClient = d.state === "client";
  const set = (s: WorkState) => api.setWorkState(s).then(apply).catch(() => undefined);
  // Formação marcada pelo responsável: o comercial não sai sozinho (o responsável termina em Equipa comercial).
  if (!lead && d.state === "training") return (
    <div role="group" aria-label="Estado" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ height: 32, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 999, border: `1px solid ${c.line}`, background: c.card, fontSize: 13, fontWeight: 700 }}>Em formação</span>
      <span style={{ fontSize: 12, color: c.muted }}>O responsável termina a formação.</span>
    </div>
  );
  const chip = (s: WorkState, text: string, warn = false, off = false) => {
    const on = d.state === s;
    return (
      <button key={s} disabled={(disabled && !on) || inClient || off} onClick={() => !on && set(s)} aria-pressed={on}
        style={{ height: 32, padding: "0 12px", borderRadius: 999, border: `1px solid ${on ? (s === "working" ? c.ok : c.brand) : c.line}`, background: on ? (s === "working" ? c.okSoft : c.brandSoft) : c.card, color: warn ? "#D70015" : off ? c.muted : c.ink, fontWeight: on ? 700 : 500, fontSize: 13, cursor: on ? "default" : "pointer", fontVariantNumeric: "tabular-nums" }}>
        {text}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Estado" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {chip("working", "A trabalhar")}
      {lead ? <>
        {chip("support", `Apoio · ${mmss(d.seconds.support + live("support"))}`)}
        {chip("training", "Formação")}
      </> : chip("office", `Office · ${mmss(Math.max(0, officeLeft))}`, false, officeLeft <= 0 && d.state !== "office")}
      {chip("break", breakLeft < 0 ? `Intervalo · +${mmss(-breakLeft)} a mais` : `Intervalo · ${mmss(breakLeft)}`, breakLeft < 0)}
      {inClient
        ? <span style={{ height: 32, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 999, border: `1px solid ${c.brand}`, background: c.brandSoft, fontSize: 13, fontWeight: 700 }}>Em cliente · {d.client?.kind === "sale" ? "Venda" : "Proposta"}</span>
        : <button disabled={disabled} onClick={() => setStarting(true)} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: `1px solid ${c.ink}`, background: c.card, color: c.ink, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>+ Em cliente</button>}
      {starting && <StartClientDialog onClose={() => setStarting(false)} onStarted={(x) => { setStarting(false); apply(x); }} />}
    </div>
  );
}
