import { useEffect, useRef, useState } from "react";
import { api, type AgendaTask } from "../api";
import { btn, btnDark, c } from "../ui";

/**
 * Avisos das tarefas da Agenda (24 nov): à hora marcada aparece um banner laranja no topo (em qualquer ecrã, mesmo em
 * chamada, sem a cortar), com «Abrir» e «Daqui a 10 min», e um som curto (que não toca durante uma chamada). Enquanto
 * houver tarefas em atraso, uma caixa vermelha fica por cima de «Terminar sessão».
 */
export function useDueTasks(userId: string) {
  const [due, setDue] = useState<AgendaTask[]>([]);
  useEffect(() => {
    let stop = false;
    const load = () => api.agenda().then((l) => { if (!stop) setDue(l.filter((t) => t.assignedTo === userId && t.status === "open" && new Date(t.dueAt).getTime() <= Date.now())); }).catch(() => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, [userId]);
  return due;
}

/** Som curto e discreto (Web Audio), só fora de chamada. */
function ding() {
  if (document.body.dataset.inCall === "1") return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.stop(ctx.currentTime + 0.4);
  } catch { /* sem som */ }
}

export function TaskBanner({ due, onOpenCompany }: { due: AgendaTask[]; onOpenCompany: (id: string) => void }) {
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const [, tick] = useState(0);
  const seen = useRef(new Set<string>());
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15_000); return () => clearInterval(t); }, []);
  const show = [...due].sort((a, b) => b.dueAt.localeCompare(a.dueAt)).find((t) => (snoozed[t.id] ?? 0) < Date.now());
  useEffect(() => { if (show && !seen.current.has(show.id)) { seen.current.add(show.id); ding(); } }, [show?.id]);
  if (!show) return null;
  const at = new Date(show.dueAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  return (
    <div role="alert" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 130, background: "#EA580C", color: "#FFFFFF", borderRadius: 14, padding: "10px 12px 10px 18px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 10px 28px rgba(0,0,0,.25)", maxWidth: "92vw" }}>
      <span style={{ fontSize: 15, fontWeight: 800 }}>Tarefa {at}: {show.type} · {show.company}</span>
      {show.description && <span style={{ fontSize: 13, opacity: 0.9, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{show.description}</span>}
      <button style={{ ...btnDark, height: 34, background: "#FFFFFF", color: "#9A3412", borderColor: "#FFFFFF" }} onClick={() => { setSnoozed((s) => ({ ...s, [show.id]: Date.now() + 10 * 60_000 })); onOpenCompany(show.companyId); }}>Abrir</button>
      <button style={{ ...btn, height: 34, background: "transparent", color: "#FFFFFF", borderColor: "rgba(255,255,255,.6)" }} onClick={() => setSnoozed((s) => ({ ...s, [show.id]: Date.now() + 10 * 60_000 }))}>Daqui a 10 min</button>
    </div>
  );
}

/** Caixa vermelha por cima de «Terminar sessão»: tarefas em atraso, até serem feitas. */
export function LateTasksBox({ due, open, onAgenda }: { due: AgendaTask[]; open: boolean; onAgenda: () => void }) {
  if (!due.length) return null;
  const oldest = [...due].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]!;
  return (
    <button type="button" onClick={onAgenda} title="Abrir a Agenda" style={{ marginTop: "auto", marginBottom: 8, border: 0, borderRadius: 10, background: c.danger, color: "#FFFFFF", padding: open ? "8px 10px" : "6px 0", cursor: "pointer", fontFamily: "inherit", textAlign: "left", display: "flex", flexDirection: "column", gap: 2 }}>
      <b style={{ fontSize: open ? 13 : 12, textAlign: open ? "left" : "center" }}>{due.length}{open ? ` tarefa${due.length === 1 ? "" : "s"} por fazer` : ""}</b>
      {open && <span style={{ fontSize: 11, opacity: 0.95, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{oldest.type} · {oldest.company}</span>}
    </button>
  );
}
