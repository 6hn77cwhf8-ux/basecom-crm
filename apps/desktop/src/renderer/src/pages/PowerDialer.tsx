import { useCallback, useEffect, useRef, useState } from "react";
import { formatPhone } from "@basecom/shared";
import { api, type Campaign, type Catalogs, type DialerEntry, type ResultInput, type User } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, fmtDate } from "../ui";
import { GROUPS, ResultPanel, type Group } from "./ResultPanel";
import { WorkStates } from "./WorkState";

/** «review»: chamada terminada, a rever o script antes de voltar ao resultado (o tempo e o que já escreveu mantêm-se). */
type Phase = "idle" | "loading" | "ready" | "calling" | "result" | "review" | "countdown" | "empty";
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Novos clientes — Power Dialer (maqueta 4). A campanha está sempre a correr: o comercial não a pausa.
 * Até existir o canal telefónico (Fase 4), o comercial marca no telemóvel e indica aqui o início e o fim da chamada.
 */
export function PowerDialer({ me, onOpenCompany }: { me: User; onOpenCompany: (id: string) => void }) {
  const [cat, setCat] = useState<Catalogs | null>(null);
  const [list, setList] = useState<Campaign[]>([]);
  const isAdmin = me.role === "admin";
  // O comercial não escolhe a campanha: trabalha na que o Administrador decidiu. O Administrador escolhe (trabalha todas).
  const [campaignId, setCampaignId] = useState<string>(() => { if (!isAdmin) return ""; try { return localStorage.getItem("bc_campaign") ?? ""; } catch { return ""; } });
  const [resultKey, setResultKey] = useState(0);
  const [copied, setCopied] = useState("");
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
  useEffect(() => {
    api.catalogs().then(setCat).catch((e) => setError(e.message)); loadCampaigns();
    if (!isAdmin) api.myCampaign().then((id) => setCampaignId(id ?? "")).catch((e) => setError(e.message));
  }, [me.id]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const campaign = list.find((k) => k.id === campaignId);

  const load = useCallback(async (autoCall: boolean) => {
    if (!campaignId) { setPhase("idle"); return; }
    setPhase("loading"); setError(""); setCallId(null);
    try {
      const n = await api.dialerNext(campaignId);
      setCur(n);
      if (!n) { setPhase("empty"); return; }
      if (autoCall && n.phone) await start(n); else setPhase("ready");
    } catch (e) { setError((e as Error).message); setPhase("idle"); }
  }, [campaignId]);
  useEffect(() => { if (isAdmin) { try { localStorage.setItem("bc_campaign", campaignId); } catch { /* sem armazenamento */ } } if (campaignId) load(false); }, [campaignId]);

  async function start(n = cur) {
    if (!n?.phone) return;
    const r = await api.startCall({ companyId: n.company.id, contactId: n.phone.id, entryId: n.entry.id, source: "new" });
    setCallId(r.id); setStartedAt(Date.now()); setPhase("calling");
  }
  async function hangUp(g: Group = "noanswer") {
    if (!callId) return;
    await api.endCall(callId).catch(() => undefined);
    setEndedAt(Date.now()); setGroup(g); setResultKey((k) => k + 1); setPhase("result");
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
  useEffect(() => { if (phase === "countdown" && left === 0 && working && campaignId) load(true); }, [phase, left, load, working, campaignId]);

  // Teclas 1 a 6: abrem o resultado durante a chamada.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((phase !== "calling" && phase !== "review") || ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey) return;
      const g = GROUPS.find((x) => x.key === e.key);
      if (!g) return;
      e.preventDefault();
      if (phase === "calling") hangUp(g.id); else { setGroup(g.id); setPhase("result"); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // Durante a chamada e o resultado, atalhos como ⌘Z / Ctrl+Z, ⌘[ ou Esc não fazem nada (não podem tirar o comercial da chamada).
  useEffect(() => {
    if (phase !== "calling" && phase !== "result" && phase !== "review") return;
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" || (mod && ["z", "y", "[", "]", "ArrowLeft", "ArrowRight", "r", "w"].includes(e.key.toLowerCase()))) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [phase]);

  const copy = (key: string, t: string) => {
    navigator.clipboard?.writeText(t).then(() => { setCopied(key); setTimeout(() => setCopied((x) => (x === key ? "" : x)), 1500); }).catch(() => undefined);
  };
  const copyBtn = (key: string, t: string) => (
    <button style={{ ...small, transition: "background .2s, color .2s", ...(copied === key ? { background: c.ok, color: "#FFF", borderColor: c.ok } : {}) }} onClick={() => copy(key, t)}>{copied === key ? "Copiado ✓" : "Copiar"}</button>
  );
  const callSecs = phase === "calling" ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Novos clientes</h1>
        {!isAdmin ? <span style={{ height: 36, display: "inline-flex", alignItems: "center", borderRadius: 10, border: `1px solid ${c.line}`, padding: "0 12px", fontSize: 14, fontWeight: 600, background: c.card }}>{campaign?.name ?? "Sem campanha atribuída"}</span> :
        <select aria-label="Campanha" value={campaignId} onChange={(e) => { if (cur && phase === "ready") api.dialerRelease(cur.entry.id).catch(() => undefined); if (campaignId) api.setWorkState("switch").catch(() => undefined); setCampaignId(e.target.value); }}
          disabled={phase === "calling" || phase === "result"} style={{ height: 36, borderRadius: 10, border: `1px solid ${c.line}`, padding: "0 10px", fontSize: 14, fontWeight: 600, background: c.card }}>
          <option value="">Escolha a campanha…</option>
          {list.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>}
        {campaign && <span style={{ fontSize: 13, color: c.muted }}>Power Dialer · {count} feitas nesta sessão · {campaign.ready} prontas de {campaign.pending}</span>}
        <span style={{ flex: 1 }} />
        <WorkStates disabled={phase === "calling" || phase === "result" || phase === "review"} onChange={(d) => setWorking(d.state === "working" || d.state === "switch")} />
      </header>
      <ErrorText>{error}</ErrorText>

      {!campaignId && <Empty text={isAdmin ? (list.length ? "Escolha a campanha para começar." : "Ainda não há campanhas de Novos clientes ativas.") : "Ainda não tem campanha atribuída. O Administrador define a campanha de cada comercial em Configurações → Campanhas e scripts."} />}
      {phase === "empty" && <Empty text="Não há mais empresas prontas nesta campanha agora. As novas tentativas agendadas voltam a aparecer à hora marcada." action={<button style={btn} onClick={() => load(false)}>Verificar de novo</button>} />}

      {cur && cat && (phase === "ready" || phase === "calling" || phase === "loading" || phase === "review") && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 12, flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
            <section style={{ ...card, padding: "18px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Script da chamada</span>
                {phase === "calling" && <Chip tone="brand">Em chamada · {mmss(callSecs)}</Chip>}
                {phase === "review" && <Chip tone="warn">Chamada terminada · resultado por registar</Chip>}
              </div>
              {cur.decisors[0] && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "4px 0 2px" }}>
                  <span style={{ fontSize: 13, color: c.muted }}>Responsável</span>
                  <span style={{ fontSize: 30, fontWeight: 800, lineHeight: "36px", color: c.brand }}>{cur.decisors[0]}</span>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 22, lineHeight: "32px", whiteSpace: "pre-wrap" }}><Highlight text={cur.script} marks={[cur.company.name, ...cur.decisors]} /></p>
            </section>
            <section style={{ ...card, padding: "10px 14px", maxHeight: 220, minHeight: 0, overflow: "auto" }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Feedback anterior · mais recente primeiro</span>
              {cur.history.length === 0 && <p style={{ fontSize: 13, color: c.muted }}>Sem histórico.</p>}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 }}><tbody>
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
                <b style={{ fontSize: 16, flex: 1, color: c.brand }}>{cur.company.name}</b>
                {copyBtn("name", cur.company.name)}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <span style={{ flex: 1 }}>NIF {cur.company.nif}</span>{copyBtn("nif", cur.company.nif)}
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
              {phase === "review"
                ? <button style={{ ...btnDark, height: 48, fontSize: 16, background: c.brand, borderColor: c.brand }} onClick={() => setPhase("result")}>Voltar ao resultado →</button>
                : phase !== "calling"
                ? <button style={{ ...btnDark, height: 48, fontSize: 16 }} disabled={!cur.phone || phase === "loading" || !working} onClick={() => start().catch((e) => setError(e.message))}>{working ? "Iniciar chamada" : "Em pausa"}</button>
                : <button style={{ ...btnDark, height: 48, fontSize: 16, background: "#D70015", borderColor: "#D70015" }} onClick={() => hangUp()}>Desligar · {mmss(callSecs)}</button>}
              <span style={{ fontSize: 12, color: c.muted }}>Marque o número no telemóvel e carregue em «Iniciar chamada». No fim, carregue no resultado (ou em «Desligar»).</span>
            </section>
          </aside>
        </div>
      )}

      {cur && cat && (phase === "result" || phase === "review") && (
        <ResultPanel key={resultKey} hidden={phase === "review"} needsKind={cur.company.needsKind} cat={cat} group={group} onGroup={setGroup} busy={busy} error={error} endedAt={endedAt}
          company={{ name: cur.company.name, nif: cur.company.nif, phone: cur.phone ? formatPhone(cur.phone.value) : undefined, decisor: cur.decisors[0] }}
          onBack={() => setPhase("review")} onSave={save} />
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

/** Script com o nome da empresa e do responsável em destaque (cor da marca). */
function Highlight({ text, marks }: { text: string; marks: string[] }) {
  const m = [...new Set(marks.filter((x) => x && x.length > 2))].sort((a, b) => b.length - a.length);
  if (!m.length) return <>{text}</>;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${m.map(esc).join("|")})`, "g"));
  return <>{parts.map((p, i) => (m.includes(p) ? <b key={i} style={{ color: c.brand }}>{p}</b> : <span key={i}>{p}</span>))}</>;
}
function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return <section style={{ ...card, padding: 40, textAlign: "center", color: c.muted, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>{text}{action}</section>;
}
