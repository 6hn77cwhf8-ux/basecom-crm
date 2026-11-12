import { useCallback, useEffect, useRef, useState } from "react";
import { formatPhone } from "@basecom/shared";
import { api, type Campaign, type Catalogs, type DialerEntry, type ResultInput, type User } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, fmtDate } from "../ui";
import { GROUPS, ResultPanel, type Group } from "./ResultPanel";
import { WorkStates } from "./WorkState";

type Phase = "idle" | "loading" | "ready" | "calling" | "result" | "countdown" | "empty";
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Novos clientes — Power Dialer (maqueta 4). A campanha está sempre a correr: o comercial não a pausa.
 * Até existir o canal telefónico (Fase 4), o comercial marca no telemóvel e indica aqui o início e o fim da chamada.
 */
export function PowerDialer({ me, onOpenCompany }: { me: User; onOpenCompany: (id: string) => void }) {
  const [cat, setCat] = useState<Catalogs | null>(null);
  const [list, setList] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>(() => { try { return localStorage.getItem("bc_campaign") ?? ""; } catch { return ""; } });
  const [phase, setPhase] = useState<Phase>("idle");
  const [cur, setCur] = useState<DialerEntry | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState(0);
  const [group, setGroup] = useState<Group>("noanswer");
  const [count, setCount] = useState(0);
  const [lastSummary, setLastSummary] = useState("");
  const [working, setWorking] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCampaigns = () => api.campaigns().then((l) => setList(l.filter((k) => k.mode === "new" && k.status === "active" && (me.role === "admin" || k.members.some((m) => m.id === me.id))))).catch((e) => setError(e.message));
  useEffect(() => { api.catalogs().then(setCat).catch((e) => setError(e.message)); loadCampaigns(); }, [me.id]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const campaign = list.find((k) => k.id === campaignId);

  const load = useCallback(async (autoCall: boolean) => {
    if (!campaignId) return;
    setPhase("loading"); setError(""); setCallId(null);
    try {
      const n = await api.dialerNext(campaignId);
      setCur(n);
      if (!n) { setPhase("empty"); return; }
      if (autoCall && n.phone) await start(n); else setPhase("ready");
    } catch (e) { setError((e as Error).message); setPhase("idle"); }
  }, [campaignId]);
  useEffect(() => { try { localStorage.setItem("bc_campaign", campaignId); } catch { /* sem armazenamento */ } if (campaignId) load(false); }, [campaignId]);

  async function start(n = cur) {
    if (!n?.phone) return;
    const r = await api.startCall({ companyId: n.company.id, contactId: n.phone.id, entryId: n.entry.id, source: "new" });
    setCallId(r.id); setStartedAt(Date.now()); setPhase("calling");
  }
  async function hangUp(g: Group = "noanswer") {
    if (!callId) return;
    await api.endCall(callId).catch(() => undefined);
    setEndedAt(Date.now()); setGroup(g); setPhase("result");
  }
  async function save(r: ResultInput) {
    if (!callId) return;
    setBusy(true); setError("");
    try {
      const res = await api.saveResult(callId, r);
      setCount((x) => x + 1); setLastSummary(`${res.outcome}${res.summary.length ? " · " + res.summary.filter((s) => !s.startsWith("Nova tentativa")).join(" · ") : ""}`);
      setPhase("countdown"); setEndedAt(Date.now()); loadCampaigns();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  // Encadeamento: 10 s depois de guardar, a empresa seguinte é marcada automaticamente.
  const wait = cat?.timeLimits.nextCallSeconds ?? 10;
  const left = phase === "countdown" ? Math.max(0, wait - Math.floor((Date.now() - endedAt) / 1000)) : 0;
  useEffect(() => { if (phase === "countdown" && left === 0 && working) load(true); }, [phase, left, load, working]);

  // Teclas 1 a 6: abrem o resultado durante a chamada.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (phase !== "calling" || (e.target as HTMLElement).tagName === "INPUT") return;
      const g = GROUPS.find((x) => x.key === e.key);
      if (g) { e.preventDefault(); hangUp(g.id); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => undefined);
  const callSecs = phase === "calling" ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Novos clientes</h1>
        <select aria-label="Campanha" value={campaignId} onChange={(e) => { if (cur && phase === "ready") api.dialerRelease(cur.entry.id).catch(() => undefined); if (campaignId) api.setWorkState("switch").catch(() => undefined); setCampaignId(e.target.value); }}
          disabled={phase === "calling" || phase === "result"} style={{ height: 36, borderRadius: 10, border: `1px solid ${c.line}`, padding: "0 10px", fontSize: 14, fontWeight: 600, background: c.card }}>
          <option value="">Escolha a campanha…</option>
          {list.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        {campaign && <span style={{ fontSize: 13, color: c.muted }}>Power Dialer · {count} feitas nesta sessão · {campaign.ready} prontas de {campaign.pending}</span>}
        <span style={{ flex: 1 }} />
        <WorkStates disabled={phase === "calling" || phase === "result"} onChange={(d) => setWorking(d.state === "working" || d.state === "switch")} />
      </header>
      <ErrorText>{error}</ErrorText>

      {!campaignId && <Empty text={list.length ? "Escolha a campanha para começar." : "Não tem campanhas de Novos clientes atribuídas. O Administrador atribui em Configurações → Campanhas e scripts."} />}
      {phase === "empty" && <Empty text="Não há mais empresas prontas nesta campanha agora. As novas tentativas agendadas voltam a aparecer à hora marcada." action={<button style={btn} onClick={() => load(false)}>Verificar de novo</button>} />}

      {cur && cat && (phase === "ready" || phase === "calling" || phase === "loading") && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 12, flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
            <section style={{ ...card, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Script da chamada</span>
                {phase === "calling" && <Chip tone="brand">Em chamada · {mmss(callSecs)}</Chip>}
              </div>
              <p style={{ margin: 0, fontSize: 22, lineHeight: "32px", whiteSpace: "pre-wrap" }}>{cur.script}</p>
            </section>
            <section style={{ ...card, padding: "12px 16px", flex: 1, minHeight: 0, overflow: "auto" }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Feedback anterior · mais recente primeiro</span>
              {cur.history.length === 0 && <p style={{ fontSize: 13, color: c.muted }}>Sem histórico.</p>}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 6 }}><tbody>
                {cur.history.map((h, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap", color: c.muted, width: 1 }}>{h.kind === "call" ? fmtDate(h.at) : "Importado"}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap", width: 1 }}>{h.user ?? "—"}</td>
                    <td style={{ padding: "6px 0" }}>{h.text}</td>
                  </tr>
                ))}
              </tbody></table>
            </section>
          </div>

          <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <section style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <b style={{ fontSize: 16, flex: 1 }}>{cur.company.name}</b>
                <button style={small} onClick={() => copy(cur.company.name)}>Copiar</button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <span style={{ flex: 1 }}>NIF {cur.company.nif}</span><button style={small} onClick={() => copy(cur.company.nif)}>Copiar</button>
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{cur.phone ? formatPhone(cur.phone.value) : "Sem telefone"}</div>
              <span style={{ fontSize: 12, color: c.muted }}>
                {cur.phone?.type === "mobile" ? "Móvel" : "Fixo"} · tentativa {cur.entry.attempts + 1} de {cat.catalogs.attempts.maxAttemptsTotal} · {cur.company.accountType === "client" ? "Cliente" : "NN"} · {cur.company.walletKind}{cur.company.owner ? ` · carteira de ${cur.company.owner}` : ""}
              </span>
              {cur.decisors.length > 0 && <span style={{ fontSize: 13 }}>Decisores: {cur.decisors.join(" · ")}</span>}
              <button style={{ ...small, alignSelf: "flex-start" }} onClick={() => onOpenCompany(cur.company.id)}>Abrir ficha completa →</button>
            </section>
            <section style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Telefone · ligação manual até à app Android</span>
              {phase !== "calling"
                ? <button style={{ ...btnDark, height: 48, fontSize: 16 }} disabled={!cur.phone || phase === "loading" || !working} onClick={() => start().catch((e) => setError(e.message))}>{working ? "Iniciar chamada" : "Em pausa"}</button>
                : <button style={{ ...btnDark, height: 48, fontSize: 16, background: "#D70015", borderColor: "#D70015" }} onClick={() => hangUp()}>Desligar · {mmss(callSecs)}</button>}
              <span style={{ fontSize: 12, color: c.muted }}>Marque o número no telemóvel e carregue em «Iniciar chamada». No fim, carregue no resultado (ou em «Desligar»).</span>
            </section>
          </aside>
        </div>
      )}

      {cur && cat && phase === "result" && (
        <ResultPanel cat={cat} group={group} onGroup={setGroup} busy={busy} error={error} endedAt={endedAt}
          company={{ name: cur.company.name, nif: cur.company.nif, phone: cur.phone ? formatPhone(cur.phone.value) : undefined, decisor: cur.decisors[0] }}
          onBack={() => setPhase("calling")} onSave={save} />
      )}

      {phase === "countdown" && (
        <section style={{ ...card, padding: 32, textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 14, color: c.muted }}>Resultado guardado: {lastSummary}</span>
          {working ? <>
            <span style={{ fontSize: 40, fontWeight: 800 }}>{left}</span>
            <span style={{ fontSize: 14 }}>Próxima empresa em {left} s</span>
            <button style={btnDark} onClick={() => load(true)}>Ligar já</button>
          </> : <span style={{ fontSize: 16, fontWeight: 600 }}>Em pausa: carregue em «A trabalhar» para continuar.</span>}
        </section>
      )}

      {cur && (phase === "calling") && (
        <footer style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
          {GROUPS.map((g) => (
            <button key={g.id} onClick={() => hangUp(g.id)} style={{ ...btn, height: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 15, ...(g.id === "sale" ? { background: c.ink, color: "#FFF", borderColor: c.ink } : {}) }}>
              {g.label}<span style={{ fontSize: 11, opacity: 0.6 }}>tecla {g.key}</span>
            </button>
          ))}
        </footer>
      )}
    </div>
  );
}

const small = { ...btn, height: 28, fontSize: 12, padding: "0 10px" };
function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return <section style={{ ...card, padding: 40, textAlign: "center", color: c.muted, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>{text}{action}</section>;
}
