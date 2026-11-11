import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { cycleForDate, cycleFromIndex } from "@basecom/shared";
import { api, type ScheduledChange } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, Field, fmtDate, input, td, th } from "../ui";

/** Ciclo atual e seguinte, para escolher a partir de quando vale a transferência. */
function cycles() {
  const cur = cycleForDate(new Date());
  const idx = Math.round((cur.start.getTime() - Date.UTC(2026, 0, 5)) / (28 * 86_400_000));
  const next = cycleFromIndex(idx + 1);
  const d = (x: Date) => x.toLocaleDateString("pt-PT", { timeZone: "UTC" });
  return { current: `${cur.label} (desde ${d(cur.start)})`, next: `${next.label} (a partir de ${d(next.start)})` };
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(11,11,11,0.32)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 520, maxWidth: "92vw", maxHeight: "86vh", overflow: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Transferência de carteira (só Administrador): vale a partir do início de um ciclo, com justificação. */
export function TransferDialog({ companyIds, label, onClose, onDone }: { companyIds: string[]; label: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [to, setTo] = useState("");
  const [when, setWhen] = useState<"current" | "next">("next");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const cy = useMemo(cycles, []);
  useEffect(() => { api.users().then((u) => setOwners(u.filter((x) => x.active && x.role !== "admin"))).catch((e) => setError(e.message)); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await api.transfer({ companyIds, toOwnerId: to === "none" ? null : to, when, reason });
      onDone(r.applied ? `${r.scheduled} empresa(s) transferida(s) em ${r.cycle}.` : `${r.scheduled} transferência(s) agendada(s) para o início de ${r.cycle}.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title="Transferir carteira" onClose={onClose}>
      <p style={{ margin: 0, fontSize: 14, color: c.muted }}>{label}. As vendas já feitas continuam do comercial que as fez. Fica no histórico da empresa e na auditoria.</p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Novo responsável">
          <select style={input} value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="" disabled>Escolha…</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value="none">Sem carteira (devolver à Basecom)</option>
          </select>
        </Field>
        <Field label="A partir de">
          <select style={input} value={when} onChange={(e) => setWhen(e.target.value as "current" | "next")}>
            <option value="next">Próximo ciclo: {cy.next}</option>
            <option value="current">Ciclo atual: {cy.current}</option>
          </select>
        </Field>
        <Field label="Justificação (obrigatória)">
          <textarea style={{ ...input, height: 80, padding: 10, resize: "vertical" }} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} placeholder="Ex.: pedido do Chefe de Equipa por reorganização das zonas" />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={btn} onClick={onClose}>Cancelar</button>
          <button style={btnDark} disabled={busy || !to || reason.trim().length < 5}>{busy ? "A guardar…" : when === "current" ? "Transferir já" : "Agendar transferência"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Transferências à espera do início do ciclo (Administrador pode cancelar). */
export function ScheduledDialog({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const [list, setList] = useState<ScheduledChange[] | null>(null);
  const [error, setError] = useState("");
  const load = () => api.scheduledTransfers().then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  return (
    <Modal title="Transferências agendadas" onClose={onClose}>
      <ErrorText>{error}</ErrorText>
      {list?.length === 0 && <p style={{ margin: 0, color: c.muted, fontSize: 14 }}>Não há transferências à espera do início de um ciclo.</p>}
      {list && list.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ color: c.muted }}>{["Empresa", "Para", "A partir de", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.id}>
              <td style={td}><b>{x.company}</b><div style={{ color: c.muted, fontSize: 12 }}>{x.reason}</div></td>
              <td style={td}>{x.toOwner ?? "Sem carteira"}</td>
              <td style={td}>{fmtDate(x.effectiveFrom)}</td>
              <td style={{ ...td, textAlign: "right" }}><button style={{ ...btn, height: 30 }} onClick={() => api.cancelTransfer(x.id).then(() => { load(); onChange(); }).catch((e) => setError(e.message))}>Cancelar</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}><button style={btn} onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

/** Pede uma justificação curta (NC/FC, «Não contactar»). */
export function ReasonDialog({ title, text, confirm, danger, onClose, onConfirm }: { title: string; text: string; confirm: string; danger?: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await onConfirm(reason); } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ margin: 0, fontSize: 14, color: c.muted }}>{text}</p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Justificação (obrigatória)"><textarea style={{ ...input, height: 70, padding: 10, resize: "vertical" }} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} autoFocus /></Field>
        <ErrorText>{error}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={btn} onClick={onClose}>Cancelar</button>
          <button style={{ ...btnDark, ...(danger ? { background: "#A1000F", borderColor: "#A1000F" } : {}) }} disabled={busy || reason.trim().length < 5}>{confirm}</button>
        </div>
      </form>
    </Modal>
  );
}

export const KIND_LABEL: Record<string, string> = { import: "Importação", transfer: "Transferência", release: "Devolvida à Basecom", conquest: "Conquista" };
export const StatusChip = ({ s }: { s: string }) => <Chip tone={s === "applied" ? "ok" : s === "scheduled" ? "warn" : "neutral"}>{s === "applied" ? "Aplicada" : s === "scheduled" ? "Agendada" : "Cancelada"}</Chip>;
