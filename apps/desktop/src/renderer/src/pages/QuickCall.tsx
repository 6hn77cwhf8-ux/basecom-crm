import { useEffect, useRef, useState } from "react";
import { formatPhone } from "@basecom/shared";
import { api, type Catalogs, type ResultInput } from "../api";
import { btn, btnDark, c, card, ErrorText } from "../ui";
import { GROUPS, ResultPanel, type Group } from "./ResultPanel";
import { useCallEnd } from "./Phone";

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Ligar a partir da ficha (ou de um número da ficha): marca no telemóvel BASECOM emparelhado, como no ecrã Ligar.
 * O resultado pode abrir durante a chamada sem desligar; só grava quando a chamada acabar.
 */
export function QuickCall({ company, contact, needsKind, onClose, onSaved }: {
  company: { id: string; name: string; nif: string }; contact: { id: string; value: string }; needsKind: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const [cat, setCat] = useState<Catalogs | null>(null);
  const [call, setCall] = useState<{ id: string; startedAt: number; viaPhone: boolean } | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [group, setGroup] = useState<Group>("noanswer");
  const [queued, setQueued] = useState(false);
  const pending = useRef<ResultInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, tick] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; started.current = true;
    api.catalogs().then(setCat).catch((e) => setError(e.message));
    api.startCall({ companyId: company.id, contactId: contact.id, source: "ficha" })
      .then((r) => setCall({ id: r.id, startedAt: Date.now(), viaPhone: r.viaPhone }))
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  async function save(r: ResultInput) {
    if (!call) return;
    if (endedAt === null) { pending.current = r; setQueued(true); return; }
    setBusy(true); setError("");
    try { await api.saveResult(call.id, r); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (endedAt !== null && pending.current) { const r = pending.current; pending.current = null; setQueued(false); saveRef.current(r); }
  }, [endedAt]);

  useCallEnd(call?.id ?? null, !!call && endedAt === null, (end, answered) => {
    setEndedAt(end);
    if (!resultOpen) { setGroup(answered === false ? "noanswer" : "refuse"); setResultOpen(true); }
  });
  async function hangUp() {
    if (!call) return;
    await api.endCall(call.id).catch(() => undefined);
    setEndedAt(Date.now()); setResultOpen(true);
  }
  function openResult(g: Group) {
    setGroup(g); setResultOpen(true);
    // Sem telemóvel, o resultado marca o fim da chamada (como antes).
    if (call && !call.viaPhone && endedAt === null) hangUp();
  }

  const live = endedAt === null;
  const secs = call ? Math.floor((Date.now() - call.startedAt) / 1000) : 0;
  return (
    <div role="dialog" aria-modal="true" aria-label={`Chamada para ${company.name}`} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(11,11,11,0.32)", display: "grid", placeItems: "center" }}>
      <div style={{ width: 860, maxWidth: "94vw", height: resultOpen ? "86vh" : "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {(!resultOpen || !cat) && (
          <section style={{ ...card, padding: 24, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Chamada · {company.name}</span>
                <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{formatPhone(contact.value)}</span>
                <span style={{ fontSize: 13, color: call?.viaPhone ? "#1E6F33" : c.muted }}>
                  {!call ? "A preparar…" : call.viaPhone ? "O telemóvel está a marcar. Pode abrir o resultado sem desligar." : "Telemóvel BASECOM sem ligação: marque o número no telemóvel."}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {!call && error && <button style={btn} onClick={onClose}>Fechar</button>}
                {call && <button style={{ ...btnDark, height: 48, padding: "0 24px", background: "#D70015", borderColor: "#D70015" }} onClick={hangUp}>Desligar · {mmss(secs)}</button>}
              </div>
            </div>
            {call && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                {GROUPS.map((g) => <button key={g.id} style={{ ...btn, height: 48 }} onClick={() => openResult(g.id)}>{g.label}</button>)}
              </div>
            )}
            <ErrorText>{error}</ErrorText>
          </section>
        )}
        {resultOpen && cat && call && (
          <ResultPanel cat={cat} group={group} onGroup={setGroup} busy={busy} error={error} endedAt={endedAt ?? Date.now()} needsKind={needsKind}
            live={live ? { secs, queued, onHangUp: () => { hangUp(); } } : undefined}
            company={{ name: company.name, nif: company.nif, phone: formatPhone(contact.value) }}
            backLabel="Voltar à chamada" onBack={() => setResultOpen(false)} onSave={save} />
        )}
      </div>
    </div>
  );
}
