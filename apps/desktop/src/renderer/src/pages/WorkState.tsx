import { useEffect, useState } from "react";
import { api, type DaySummary, type WorkState } from "../api";
import { c } from "../ui";

export const STATE_LABEL: Record<WorkState, string> = { working: "A trabalhar", training: "Formação", break: "Intervalo", switch: "Mudança de campanha" };
export const mmss = (s: number) => `${s < 0 ? "-" : ""}${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`;

/**
 * Estados do comercial (maqueta 4): A trabalhar · Formação · Intervalo, com o tempo que resta.
 * Fora de «A trabalhar» não são marcadas chamadas. Ultrapassar os limites não bloqueia, mas fica assinalado.
 */
export function WorkStates({ onChange, disabled }: { onChange?: (s: DaySummary) => void; disabled?: boolean }) {
  const [d, setD] = useState<DaySummary | null>(null);
  const [at, setAt] = useState(Date.now());
  const load = () => api.today().then((x) => { setD(x); setAt(Date.now()); onChange?.(x); }).catch(() => undefined);
  // Volta a ler logo a seguir ao primeiro sinal de presença (ao entrar, o estado ainda pode não existir).
  useEffect(() => { load(); const first = setTimeout(load, 2500); const t = setInterval(load, 60_000); return () => { clearTimeout(first); clearInterval(t); }; }, []);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  if (!d) return null;
  const extra = Math.floor((Date.now() - at) / 1000);
  const live = (s: WorkState) => (d.state === s ? extra : 0);
  const breakLeft = d.limits.breakSeconds - d.used.break - live("break");
  const trainLeft = d.limits.trainingSeconds - d.used.ownTraining - live("training");
  const set = (s: WorkState) => api.setWorkState(s).then((x) => { setD(x); setAt(Date.now()); onChange?.(x); }).catch(() => undefined);
  const chip = (s: WorkState, text: string, warn = false) => {
    const on = d.state === s;
    return (
      <button key={s} disabled={disabled && !on} onClick={() => !on && set(s)} aria-pressed={on}
        style={{ height: 32, padding: "0 12px", borderRadius: 999, border: `1px solid ${on ? (s === "working" ? "#248A3D" : c.brand) : c.line}`, background: on ? (s === "working" ? "#E8F5EC" : c.brandSoft) : c.card, color: warn ? "#D70015" : c.ink, fontWeight: on ? 700 : 500, fontSize: 13, cursor: on ? "default" : "pointer", fontVariantNumeric: "tabular-nums" }}>
        {text}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Estado" style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {chip("working", "A trabalhar")}
      {chip("training", trainLeft < 0 ? `Formação · +${mmss(-trainLeft)} a mais` : `Formação · ${mmss(trainLeft)}`, trainLeft < 0)}
      {chip("break", breakLeft < 0 ? `Intervalo · +${mmss(-breakLeft)} a mais` : `Intervalo · ${mmss(breakLeft)}`, breakLeft < 0)}
    </div>
  );
}
