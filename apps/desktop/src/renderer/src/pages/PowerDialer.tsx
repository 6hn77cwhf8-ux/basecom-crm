import { useCallback, useEffect, useRef, useState } from "react";
import { formatPhone, renderScript, spokenName } from "@basecom/shared";
import { api, INCOMING_DISMISS, INCOMING_EVENT, OPEN_SCRIPT_EVENT, pendingScript, type Campaign, type Catalogs, type ClientWork, type DialerEntry, type ResultInput, type User } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, fmtDate, fmtEur, input, dialOnComputer } from "../ui";
import { GROUPS, ResultPanel, type Group } from "./ResultPanel";
import { WorkStates } from "./WorkState";
import { PhoneDialog, useCallEnd, usePhone } from "./Phone";
import { ClientWorkCard } from "./ClientWork";
import { FloatingCall, MuteButton } from "./FloatingCall";
import { createPortal } from "react-dom";
import { DatePicker } from "./DatePicker";
import { overlay } from "../overlay";

/** «review»: chamada terminada, a rever o script antes de voltar ao resultado (o tempo e o que já escreveu mantêm-se). */
type Phase = "idle" | "loading" | "ready" | "calling" | "result" | "review" | "countdown" | "empty";
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * Novos clientes — Power Dialer (maqueta 4). A campanha está sempre a correr: o comercial não a pausa.
 * Até existir o canal telefónico (Fase 4), o comercial marca no telemóvel e indica aqui o início e o fim da chamada.
 */
/**
 * O Ligar fica sempre montado (escondido nas outras páginas): a chamada não se perde ao mudar de página
 * e aparece o cartão flutuante (desenho 13).
 */
export function PowerDialer({ me, onOpenCompany, active = true, onShow, onReceived }: { me: User; onOpenCompany: (id: string) => void; active?: boolean; onShow?: () => void; onReceived?: () => void }) {
  const [cat, setCat] = useState<Catalogs | null>(null);
  const [list, setList] = useState<Campaign[]>([]);
  const isAdmin = me.role === "admin";
  // O comercial não escolhe a campanha: trabalha na que o Administrador decidiu. O Administrador escolhe (trabalha todas).
  const [campaignId, setCampaignId] = useState<string>(() => { if (!isAdmin) return ""; try { return localStorage.getItem("bc_campaign") ?? ""; } catch { return ""; } });
  const [resultKey, setResultKey] = useState(0);
  const [copied, setCopied] = useState("");
  // Script em dois passos: abertura → (sim / mudar de decisor) → apresentação.
  const [step, setStep] = useState<"opening" | "pitch">("opening");
  const [decisor, setDecisor] = useState<{ salutation: string | null; name: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [newSal, setNewSal] = useState("");
  const [newName, setNewName] = useState("");
  // Preview: «Consultei a NOS» obrigatório antes de ligar; «Saltar com motivo».
  const [consulted, setConsulted] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  // Em cliente (proposta/venda com OP): enquanto dura, não se marca nenhuma chamada.
  const [client, setClient] = useState<ClientWork | null>(null);
  const [wsKey, setWsKey] = useState(0);
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
  const consultedRef = useRef(false);
  // Telemóvel (app BASECOM): marca sozinho e informa o fim da chamada.
  const phone = usePhone();
  const [viaPhone, setViaPhone] = useState(false);
  // Resultado aberto durante a chamada no telemóvel: a chamada continua; o resultado grava quando ela acabar.
  const [live, setLive] = useState(false);
  const [queued, setQueued] = useState(false);
  const pendingRef = useRef<ResultInput | null>(null);
  const [phoneDialog, setPhoneDialog] = useState(false);
  const [muted, setMuted] = useState(false);
  const [prior, setPrior] = useState(0);
  // Chamadas em simultâneo (18 nov): o CRM segue o telemóvel; com uma recebida a tocar ou aberta, não marca a seguinte.
  const [incoming, setIncoming] = useState<{ active: boolean; open: boolean; id: string | null; who: string | null; number?: string | null; companyIds?: string[] }>({ active: false, open: false, id: null, who: null });
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const reloadAfter = useRef(false);
  useEffect(() => {
    const h = (e: Event) => setIncoming((e as CustomEvent).detail);
    window.addEventListener(INCOMING_EVENT, h);
    return () => window.removeEventListener(INCOMING_EVENT, h);
  }, []);
  // 20 nov: «Abrir script» numa chamada recebida — mostra o script grande dessa empresa e regista o resultado aqui
  // (na entrada da campanha onde ela está). Uma chamada feita que ainda estava a marcar é cancelada (o CRM segue o telemóvel).
  const [received, setReceived] = useState(false);
  const openReceivedRef = useRef<(companyId: string, number: string, dial?: { contactId: string }) => void>(() => undefined);
  const holdRef = useRef(false);
  useEffect(() => { if (phase === "ready" || phase === "countdown" || phase === "empty") holdRef.current = false; }, [phase]);
  openReceivedRef.current = async (companyId: string, number: string, dial?: { contactId: string }) => {
    holdRef.current = true;
    if (phase === "result" || phase === "review") { setError(`Registe primeiro o resultado de ${cur?.company.name ?? "a chamada anterior"}; depois abra o script da chamada recebida.`); return; }
    setError("");
    if (phase === "calling" && callId) await api.discardCall(callId).catch(() => undefined);
    try {
      const v = await api.companyScriptView(companyId);
      setCur(v); setConsulted(false); consultedRef.current = false; setSkipping(false); setStep("opening"); setDecisor(null); setChanging(false); setNewName(""); setNewSal("");
      // 24 nov: retribuir a chamada abre sempre o script grande e marca o número (no telemóvel ou no computador).
      const r = dial
        ? await api.startCall({ companyId, contactId: dial.contactId, entryId: v.entry.id || null, source: "retribuir" }).catch(() => api.startCall({ companyId, contactId: dial.contactId, source: "retribuir" }))
        : await api.startCall({ companyId, entryId: v.entry.id || null, source: "recebida", phone: number }).catch(() => api.startCall({ companyId, source: "recebida", phone: number }));
      if (dial && !r.viaPhone) dialOnComputer(number);
      setPrior(r.priorResultSeconds ?? 0);
      setCallId(r.id); setStartedAt(Date.now()); setViaPhone(dial ? r.viaPhone : true); setLive(false); setQueued(false); pendingRef.current = null; setReceived(!dial); setPhase("calling");
    } catch (e) { holdRef.current = false; setError((e as Error).message); }
  };
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ companyId: string; number: string; contactId?: string }>).detail; pendingScript.current = null; openReceivedRef.current(d.companyId, d.number, d.contactId ? { contactId: d.contactId } : undefined); };
    window.addEventListener(OPEN_SCRIPT_EVENT, h);
    // O Ligar acabou de abrir por causa de uma chamada: abre a empresa certa (e não a seguinte da fila).
    const p = pendingScript.current;
    if (p && Date.now() - p.at < 60_000) { pendingScript.current = null; setTimeout(() => openReceivedRef.current(p.companyId, p.number, p.contactId ? { contactId: p.contactId } : undefined), 0); }
    return () => window.removeEventListener(OPEN_SCRIPT_EVENT, h);
  }, []);
  useEffect(() => { if (phase === "countdown" || phase === "ready" || phase === "idle") setReceived(false); }, [phase]);
  // Acabou a recebida e a marcação tinha sido cancelada: a empresa volta (início da fila), sem marcar sozinho.
  useEffect(() => { if (!incoming.active && reloadAfter.current) { reloadAfter.current = false; load(false); } }, [incoming.active]);
  // 26 nov: chamada em curso por cima de todas as aplicações quando o CRM não está à frente (programa do computador 0.16+).
  useEffect(() => {
    if (!overlay || !cur) return;
    if (phase !== "calling") { overlay.hide("call"); return; }
    overlay.show("call", { tone: "dark", subtitle: received ? "Chamada recebida" : "Chamada em curso", title: cur.company.name, lines: [cur.phone ? formatPhone(cur.phone.value) : ""], since: startedAt,
      buttons: [...(viaPhone ? [{ id: "mute", label: muted ? "Som" : "Mute" }] : []), { id: "hangup", label: "Desligar", kind: "danger" }, { id: "crm", label: "CRM" }] });
  }, [phase, cur?.company.id, muted, viaPhone]);
  useEffect(() => () => overlay?.hide("call"), []);
  const callActions = useRef({ mute: () => undefined as unknown, hangup: () => undefined as unknown });
  useEffect(() => overlay?.onAction((kind, action) => { if (kind !== "call") return; if (action === "mute") callActions.current.mute(); if (action === "hangup") callActions.current.hangup(); }), []);
  // 24 nov: durante a chamada os avisos de tarefa não fazem som.
  useEffect(() => { if (phase !== "calling" || !cur) return; document.body.dataset.inCall = "1"; document.body.dataset.callCompanyId = cur.company.id; return () => { delete document.body.dataset.inCall; delete document.body.dataset.callCompanyId; }; }, [phase, cur?.company.id]);
  const toggleMute = () => api.phoneMute(!muted).then((r) => setMuted(r.on)).catch((e) => setError((e as Error).message));
  useEffect(() => { setMuted(false); }, [callId]);

  const loadCampaigns = () => api.campaigns().then((l) => setList(l.filter((k) => k.status === "active" && (me.role === "admin" || k.members.some((m) => m.id === me.id))))).catch((e) => setError(e.message));
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
      setCur(n); setConsulted(false); consultedRef.current = false; setSkipping(false); setSkipReason(""); setStep("opening"); setDecisor(null); setChanging(false); setNewName(""); setNewSal("");
      if (!n) { setPhase("empty"); return; }
      // 26 nov: empresa com oportunidade em curso não marca sozinha: o comercial escolhe Ligar, Saltar ou Follow-up.
      if (autoCall && n.phone && !n.opportunity) await start(n); else setPhase("ready");
    } catch (e) { setError((e as Error).message); setPhase("idle"); }
  }, [campaignId]);
  useEffect(() => {
    if (isAdmin) { try { localStorage.setItem("bc_campaign", campaignId); } catch { /* sem armazenamento */ } }
    // 27 nov: com uma chamada recebida aberta (ou a abrir), a campanha a carregar não troca a empresa no ecrã.
    if (holdRef.current) return;
    setCur(null); setPhase("idle"); if (campaignId) load(false);
  }, [campaignId]);
  // Sem tempos mortos: nunca fica sem campanha. Entra na definida pelo Administrador; se não houver, na primeira disponível.
  useEffect(() => {
    if (!list.length) return;
    if (!campaignId || !list.some((k) => k.id === campaignId)) setCampaignId(list[0]!.id);
  }, [list, campaignId]);

  async function start(n = cur) {
    if (!n?.phone) return;
    const preview = n.campaign.dialMode === "preview";
    const r = await api.startCall({ companyId: n.company.id, contactId: n.phone.id, entryId: n.entry.id, source: preview ? "current" : "new", consultedNos: preview ? consultedRef.current : undefined });
    if (!r.viaPhone) dialOnComputer(n.phone.value);
    // Religar a mesma empresa antes de guardar: o tempo de registo continua de onde estava (18 nov).
    setPrior(r.priorResultSeconds ?? 0);
    setCallId(r.id); setStartedAt(Date.now()); setViaPhone(r.viaPhone); setLive(false); setQueued(false); pendingRef.current = null; setPhase("calling");
  }
  /** Tecla ou botão de resultado durante a chamada. Pelo telemóvel não desliga: o comercial preenche enquanto fala. */
  function openResult(g: Group) {
    if (!viaPhone) { hangUp(g); return; }
    setLive(true); setGroup(g); setResultKey((k) => k + 1); setPhase("result");
  }
  /** A chamada acabou com o resultado já aberto: o tempo dos 15 s conta daqui e, se já estava pronto, grava. */
  function liveEnded(end: number) {
    setLive(false); setEndedAt(end);
    const r = pendingRef.current; pendingRef.current = null; setQueued(false);
    if (r) saveRef.current(r);
  }
  async function hangUpLive() {
    if (!callId) return;
    await api.endCall(callId).catch(() => undefined);
    liveEnded(Date.now());
  }
  callActions.current = { mute: () => toggleMute(), hangup: () => hangUp() };
  async function hangUp(g: Group = "noanswer") {
    if (!callId) return;
    await api.endCall(callId).catch(() => undefined);
    setEndedAt(Date.now()); setGroup(g); setResultKey((k) => k + 1); setPhase("result");
  }
  // Fim informado pelo telemóvel: abre o resultado sozinho (não atendida → sugere «Não atende»). O tempo dos 15 s conta daí.
  useCallEnd(callId, phase === "calling" || live, (end, answered) => {
    if (live) { liveEnded(end); return; }
    setEndedAt(end); setGroup(answered === false ? "noanswer" : "refuse"); setResultKey((k) => k + 1); setPhase("result");
  });

  // 23 nov: depois de guardar o resultado, «Iniciar chamada» / «Ligar já» ficam inativos X s (3 por omissão).
  const [lockedUntil, setLockedUntil] = useState(0);
  const [, relock] = useState(0);
  const locked = Date.now() < lockedUntil;
  useEffect(() => { if (!lockedUntil) return; const t = setTimeout(() => relock((x) => x + 1), Math.max(0, lockedUntil - Date.now()) + 30); return () => clearTimeout(t); }, [lockedUntil]);
  async function save(r: ResultInput) {
    if (!callId) return;
    if (live) { pendingRef.current = r; setQueued(true); hangUpLive(); return; }
    setBusy(true); setError("");
    try {
      // Decisor mudado na abertura: fica registado no histórico da empresa.
      const changed = decisor && (decisor.name !== cur?.people[0]?.name);
      const res = await api.saveResult(callId, changed ? { ...r, newDecisor: { salutation: decisor.salutation, name: decisor.name } } : r);
      setLockedUntil(Date.now() + (cat?.timeLimits.nextCallLockSeconds ?? 3) * 1000);
      setCount((x) => x + 1); setLastSummary(`${res.outcome}${res.summary.length ? " · " + res.summary.filter((s) => !s.startsWith("Nova tentativa")).join(" · ") : ""}`);
      loadCampaigns();
      if (res.clientWork) { const t = await api.today(); setClient(t.client); setWorking(false); setWsKey((k) => k + 1); }
      // Preview: a seguinte aparece logo, mas só liga quando o comercial carregar em «Iniciar chamada».
      if (campaign?.dialMode === "preview") { load(false); return; }
      setPhase("countdown"); setEndedAt(Date.now());
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  // Encadeamento: 10 s depois de guardar, a empresa seguinte é marcada automaticamente.
  const wait = cat?.timeLimits.nextCallSeconds ?? 10;
  const left = phase === "countdown" ? Math.max(0, wait - Math.floor((Date.now() - endedAt) / 1000)) : 0;
  // Fora do Ligar (noutra página) não marca a seguinte: espera que o comercial volte.
  useEffect(() => { if (active && !incoming.active && phase === "countdown" && left === 0 && working && !client && campaignId) load(true); }, [active, incoming.active, phase, left, load, working, client, campaignId]);
  // 20 nov: vigilância — se ficar parado no 0 mais de 3 s, volta a tentar e regista o estado (para se saber a causa).
  const pauseReason = !active ? "fora do ecrã Ligar" : incoming.active ? "chamada a entrar" : !working ? "fora de «A trabalhar»" : client ? "em cliente" : !campaignId ? "sem campanha" : null;
  useEffect(() => {
    if (phase !== "countdown" || left !== 0) return;
    const t = setTimeout(() => {
      api.dialerStall(pauseReason ?? "parado sem razão — nova tentativa", { active, incoming: incoming.active, working, client: !!client, campaign: !!campaignId, phase }).catch(() => undefined);
      if (!pauseReason) load(true);
    }, 3000);
    return () => clearTimeout(t);
  }, [phase, left === 0, pauseReason]);
  /** Terminou o trabalho em cliente: volta a A trabalhar e a seguinte é marcada depois dos 10 s habituais. */
  function clientEnded() {
    setClient(null); setWorking(true); setWsKey((k) => k + 1);
    // Vinha de um resultado (proposta/venda): a contagem dos 10 s começa agora. Começado pela barra de estados: fica onde estava.
    if (phase === "countdown") setEndedAt(Date.now());
  }

  // Teclas 1 a 6: abrem o resultado durante a chamada.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!active) return;
      if ((phase !== "calling" && phase !== "review") || ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey) return;
      const g = GROUPS.find((x) => x.key === e.key);
      if (!g) return;
      e.preventDefault();
      if (phase === "calling") openResult(g.id); else { setGroup(g.id); setPhase("result"); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // Durante a chamada e o resultado, atalhos como ⌘Z / Ctrl+Z, ⌘[ ou Esc não fazem nada (não podem tirar o comercial da chamada).
  useEffect(() => {
    if (!active || (phase !== "calling" && phase !== "result" && phase !== "review")) return;
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" || (mod && ["z", "y", "[", "]", "ArrowLeft", "ArrowRight", "r", "w"].includes(e.key.toLowerCase()))) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [phase, active]);

  const copy = (key: string, t: string) => {
    navigator.clipboard?.writeText(t).then(() => { setCopied(key); setTimeout(() => setCopied((x) => (x === key ? "" : x)), 1500); }).catch(() => undefined);
  };
  const copyBtn = (key: string, t: string) => (
    <button style={{ ...small, transition: "background .2s, color .2s", ...(copied === key ? { background: c.ok, color: c.onInk, borderColor: c.ok } : {}) }} onClick={() => copy(key, t)}>{copied === key ? "Copiado ✓" : "Copiar"}</button>
  );
  // SMS «Tentámos ligar»: para o número marcado se for telemóvel; se for fixo, para o primeiro telemóvel da empresa.
  const smsTo = cur ? [cur.phone, ...cur.otherPhones].map((p) => p?.value).find((v) => !!v && /^9\d{8}$/.test(v)) : undefined;
  const callSecs = phase === "calling" ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Ligar</h1>
        {/* Entra logo na campanha que o Administrador definiu; o comercial pode mudar para outra das suas (conta como «Mudança de campanha»). */}
        <select aria-label="Campanha" value={campaignId} onChange={(e) => { if (cur && phase === "ready") api.dialerRelease(cur.entry.id).catch(() => undefined); if (campaignId) api.setWorkState("switch").catch(() => undefined); setCampaignId(e.target.value); }}
          disabled={phase === "calling" || phase === "result"} style={{ height: 36, borderRadius: 10, border: `1px solid ${c.line}`, padding: "0 10px", fontSize: 14, fontWeight: 600, background: c.card }}>
          {!campaignId && <option value="">A carregar…</option>}
          {list.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        {campaign && <span style={{ fontSize: 13, color: c.muted }}>{campaign.dialMode === "preview" ? "Preview" : "Power Dialer"} · {count} feitas nesta sessão · {campaign.ready} prontas de {campaign.pending}</span>}
        {onReceived && <button onClick={onReceived} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: c.muted, textDecoration: "underline" }}>Chamadas recebidas</button>}
        <span style={{ flex: 1 }} />
        <WorkStates key={wsKey} role={me.role} disabled={phase === "calling" || phase === "result" || phase === "review"} onChange={(d) => { setWorking(d.state === null || d.state === "working" || d.state === "switch"); setClient(d.client); }} />
      </header>
      <ErrorText>{error}</ErrorText>
      {/* Dúvida (recebida aberta a meio de uma chamada feita): pergunta com quem está a falar. */}
      {/* 24 nov: se o número que entrou é da empresa do script, é a mesma conversa: não pergunta. */}
      {incoming.open && incoming.id && askedFor !== incoming.id && phase === "calling" && cur && sameAsScript(incoming, cur) && <SameCall id={incoming.id} onSame={() => { setAskedFor(incoming.id); window.dispatchEvent(new CustomEvent(INCOMING_DISMISS, { detail: incoming.id })); }} />}
      {incoming.open && incoming.id && askedFor !== incoming.id && phase === "calling" && cur && !sameAsScript(incoming, cur) && createPortal(
        <div role="alertdialog" aria-label="Com quem está a falar?" style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(11,11,11,0.35)", display: "grid", placeItems: "center" }}>
          <div style={{ ...card, width: 560, maxWidth: "92vw", padding: 22, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 18px 44px rgba(0,0,0,.25)" }}>
            <b style={{ fontSize: 18 }}>Entrou uma chamada. Com quem está a falar?</b>
            <span style={{ fontSize: 13, color: c.muted }}>O feedback fica no cliente com quem está a falar. Confirme pelo número que vê no telemóvel.</span>
            <button style={{ ...btn, height: "auto", padding: "12px 14px", textAlign: "left", display: "flex", flexDirection: "column", gap: 2 }} onClick={() => { setAskedFor(incoming.id); window.dispatchEvent(new CustomEvent(INCOMING_DISMISS, { detail: incoming.id })); }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: c.muted }}>A chamada que eu fiz (script)</span>
              <b style={{ fontSize: 16 }}>{cur.company.name}</b>
              <span style={{ fontSize: 14 }}>{cur.phone ? formatPhone(cur.phone.value) : "—"} · continuar a minha chamada</span>
            </button>
            <button style={{ ...btnDark, height: "auto", padding: "12px 14px", textAlign: "left", display: "flex", flexDirection: "column", gap: 2 }} onClick={() => {
              setAskedFor(incoming.id); reloadAfter.current = true;
              if (callId) api.discardCall(callId).catch(() => undefined);
              setCallId(null); setPhase("idle"); setLive(false);
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.8 }}>A chamada que entrou</span>
              <b style={{ fontSize: 16 }}>{incoming.who ?? "Número desconhecido"}</b>
              <span style={{ fontSize: 14 }}>{incoming.number ? formatPhone(incoming.number) : ""} · cancelar a minha chamada</span>
            </button>
            <span style={{ fontSize: 12, color: c.muted }}>Se cancelar, {cur.company.name} volta ao início da fila (não conta como tentativa).</span>
          </div>
        </div>, document.body)}
      {!active && cur && (phase === "calling" || (phase === "result" && live)) && (
        <FloatingCall company={cur.company.name} phone={cur.phone ? formatPhone(cur.phone.value) : undefined} secs={Math.floor((Date.now() - startedAt) / 1000)}
          muted={muted} canMute={viaPhone} onMute={toggleMute} onBack={() => onShow?.()} onHangUp={() => (live ? hangUpLive() : hangUp())} />
      )}
      {!active && cur && (phase === "review" || (phase === "result" && !live)) && (
        <FloatingCall company={cur.company.name} secs={0} muted={false} canMute={false} onMute={() => undefined} onHangUp={() => undefined}
          onBack={() => { if (phase === "review") setPhase("result"); onShow?.(); }} pending={{ left: (cat?.timeLimits.resultSeconds ?? 15) - prior - Math.floor((Date.now() - endedAt) / 1000) }} />
      )}

      {!client && !campaignId && <Empty text={isAdmin ? (list.length ? "Escolha a campanha para começar." : "Ainda não há campanhas ativas.") : (list.length ? "Escolha a campanha para começar." : "Ainda não tem campanhas. O Administrador atribui em Configurações → Campanhas e scripts.")} />}
      {client && <ClientWorkCard me={me} work={client} onOpenCompany={onOpenCompany} onEnded={clientEnded} onChanged={(d) => { setClient(d.client); setWsKey((k) => k + 1); }} />}
      {!client && phase === "empty" && <Empty text="Não há mais empresas prontas nesta campanha agora. As novas tentativas agendadas voltam a aparecer à hora marcada." action={<button style={btn} onClick={() => load(false)}>Verificar de novo</button>} />}

      {!client && cur && cat && (phase === "ready" || phase === "calling" || phase === "loading" || phase === "review") && (
        /* Script e feedback anterior à esquerda; à direita, o cliente com o telefone em baixo (mais espaço para o cliente). */
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, flex: 1, minHeight: 0 }}>
          <div style={{ display: "contents" }}>
            <section style={{ ...card, gridColumn: 1, gridRow: 1, padding: "24px 32px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflow: "auto", ...(cur.callback ? { border: `3px solid ${CB_ORANGE}` } : {}) }}>
              {cur.callback && <CallbackBanner cb={cur.callback} />}
              <div style={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Script · {step === "opening" ? "1. Abertura" : "2. Apresentação"}</span>
                {cur.opportunity && <OppBadge o={cur.opportunity} onChanged={() => load(false)} onError={setError} />}
                {phase === "calling" && <Chip tone="brand">{received ? "Chamada recebida" : "Em chamada"} · {mmss(callSecs)}</Chip>}
                {phase === "review" && <Chip tone="warn">Chamada terminada · resultado por registar</Chip>}
              </div>
{(() => {
                const d = decisor ?? cur.people[0] ?? null;
                const spoken = d ? spokenName(d.salutation, d.name) : "";
                const text = renderScript(step === "opening" ? cur.scripts.opening : cur.scripts.pitch, { ...cur.vars, decisor: spoken });
                return <p style={{ margin: 0, fontSize: 24, lineHeight: "35px", whiteSpace: "pre-wrap" }}><Highlight text={text} marks={[cur.company.name, spoken]} /></p>;
              })()}
              {step === "opening" && !changing && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button style={{ ...btnDark, height: 40 }} onClick={() => { setDecisor(decisor ?? cur.people[0] ?? null); setStep("pitch"); }}>✓ Sim, é o responsável</button>
                  <button style={{ ...btn, height: 40 }} onClick={() => setChanging(true)}>Mudar de decisor</button>
                </div>
              )}
              {step === "opening" && changing && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: `1px solid ${c.line}`, borderRadius: 12 }}>
                  {cur.people.filter((p) => p.name !== (decisor ?? cur.people[0])?.name).length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: c.muted }}>Escolher:</span>
                      {cur.people.filter((p) => p.name !== (decisor ?? cur.people[0])?.name).map((p) => (
                        <button key={p.name} style={{ ...btn, height: 32, fontSize: 13 }} onClick={() => { setDecisor(p); setChanging(false); setStep("pitch"); }}>{p.salutation ? p.salutation + " " : ""}{p.name}</button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: c.muted }}>Ou escrever:</span>
                    <select aria-label="Tratamento" style={{ ...input, height: 36, width: 90 }} value={newSal} onChange={(e) => setNewSal(e.target.value)}>
                      <option value="">—</option><option>Sr.</option><option>Srª</option><option>Dr.</option><option>Drª</option><option>Eng.</option><option>Engª</option>
                    </select>
                    <input aria-label="Nome do responsável" style={{ ...input, height: 36, flex: "1 1 220px" }} placeholder="Nome do responsável" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <button style={{ ...btnDark, height: 36 }} disabled={newName.trim().length < 2} onClick={() => { setDecisor({ salutation: newSal || null, name: newName.trim() }); setChanging(false); setStep("pitch"); }}>Confirmar</button>
                    <button style={{ ...btn, height: 36 }} onClick={() => setChanging(false)}>Cancelar</button>
                  </div>
                  {/* Sugestões enquanto escreve: pessoas já registadas nesta empresa (evita duplicar o mesmo decisor). */}
                  {(() => {
                    const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    const q = norm(newName.trim());
                    const hits = q.length >= 2 ? cur.people.filter((p) => norm(p.name).includes(q)) : [];
                    return hits.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: c.muted }}>Já existe:</span>
                        {hits.map((p) => <button key={p.name} style={{ ...btn, height: 30, fontSize: 13, borderColor: c.brand }} onClick={() => { setDecisor(p); setNewName(""); setChanging(false); setStep("pitch"); }}>{p.salutation ? p.salutation + " " : ""}{p.name}</button>)}
                      </div>
                    );
                  })()}
                </div>
              )}
              {step === "pitch" && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13, color: c.muted }}>
                  <span>A falar com <b style={{ color: c.ink }}>{decisor ? `${decisor.salutation ? decisor.salutation + " " : ""}${decisor.name}` : "o responsável"}</b></span>
                  <button style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontSize: 13, color: c.muted, textDecoration: "underline" }} onClick={() => setStep("opening")}>← Voltar à abertura</button>
                </div>
              )}
              </div>
            </section>
            <section style={{ ...card, gridColumn: 1, gridRow: 2, padding: "12px 16px", minHeight: 0, overflow: "auto" }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Feedback anterior · mais recente primeiro</span>
              {cur.history.length === 0 && <p style={{ fontSize: 13, color: c.muted }}>Sem histórico.</p>}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 6 }}><tbody>
                {cur.history.map((h, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${c.line}` }}>
                    <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap", color: c.muted, width: 1 }}>{h.imported ? "Importado" : fmtDate(h.at)}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap", width: 1 }}>{h.user ?? "—"}</td>
                    <td style={{ padding: "6px 0" }}>{h.text}</td>
                  </tr>
                ))}
              </tbody></table>
            </section>
          </div>

          <aside style={{ gridColumn: 2, gridRow: "1 / span 2", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
            {/* Caixa do cliente (ordem pedida pelo Leonardo): NIF, nome, telefones, tipo, L2B e permanência, localidade, decisores, tentativa, ficha. */}
            <section style={{ ...card, flex: 1, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflow: "auto" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <b style={{ fontSize: 17, flex: 1, fontVariantNumeric: "tabular-nums" }}>NIF {cur.company.nif}</b>{copyBtn("nif", cur.company.nif)}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 17, flex: 1, lineHeight: "22px" }}>{cur.company.name}</span>{copyBtn("name", cur.company.name)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
                <b style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{cur.phone ? formatPhone(cur.phone.value) : "Sem telefone"}</b>
                {cur.otherPhones[0] && <span style={{ fontSize: 16, color: c.muted, fontVariantNumeric: "tabular-nums" }}>{formatPhone(cur.otherPhones[0].value)}</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
                <div>{cur.company.accountType === "prospect" ? <Chip>NN</Chip> : cur.company.owner || cur.company.walletKindConfirmed ? <Chip tone={cur.company.walletKind === "FC" ? "warn" : "neutral"}>{cur.company.walletKind}</Chip> : <Chip tone="brand">NC/FC</Chip>}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={lab}>L2B</span><b style={{ fontSize: 16 }}>{cur.company.l2bMonthly ? `${fmtEur(cur.company.l2bMonthly)}/mês` : "—"}</b></div>
                  <div style={{ display: "flex", flexDirection: "column" }}><span style={lab}>Fim permanência</span><b style={{ fontSize: 16 }}>{cur.company.loyaltyMonths != null ? `${cur.company.loyaltyMonths} meses` : "—"}</b></div>
                </div>
                <span style={{ fontSize: 14 }}>{[cur.company.municipality, cur.company.district].filter(Boolean).join(" - ") || "—"}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
                <div style={{ display: "flex", flexDirection: "column" }}><span style={lab}>Decisor</span><span style={{ fontSize: 14, fontWeight: 600 }}>{(() => { const p = decisor ?? cur.people[0]; return p ? `${p.salutation ? p.salutation + " " : ""}${p.name}` : "—"; })()}</span></div>
                {(() => { const main = (decisor ?? cur.people[0])?.name; const p = cur.people.find((x) => x.name !== main); return p ? <div style={{ display: "flex", flexDirection: "column" }}><span style={lab}>Decisor secundário</span><span style={{ fontSize: 14 }}>{p.salutation ? p.salutation + " " : ""}{p.name}</span></div> : null; })()}
              </div>
              <span style={{ fontSize: 12, color: c.muted, fontWeight: 300 }}>{cur.phone?.type === "mobile" ? "Móvel" : "Fixo"} · tentativa {cur.entry.attempts + 1} de {cat.catalogs.attempts.maxAttemptsTotal}{cur.company.owner ? ` · carteira de ${cur.company.owner}` : ""}</span>
              <button style={{ ...small, alignSelf: "flex-start" }} onClick={() => onOpenCompany(cur.company.id)}>Abrir ficha completa →</button>
            </section>
            <section style={{ ...card, flex: "0 0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Telefone</span>
              {phase === "review"
                ? <button style={{ ...btnDark, height: 48, fontSize: 16, background: c.brand, borderColor: c.brand }} onClick={() => setPhase("result")}>Voltar ao resultado →</button>
                : phase !== "calling"
                ? <>
                  {cur.campaign.dialMode === "preview" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, fontWeight: 600 }}><input type="checkbox" checked={consulted} onChange={(e) => { setConsulted(e.target.checked); consultedRef.current = e.target.checked; }} /> Consultei a NOS</label>
                      {!skipping ? <button style={{ ...btn, height: 34, fontSize: 13 }} onClick={() => setSkipping(true)}>Saltar com motivo</button> : (
                        <div style={{ display: "flex", gap: 6 }}>
                          <input style={{ ...input, height: 34, flex: 1 }} autoFocus placeholder="Motivo" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} />
                          <button style={{ ...btnDark, height: 34, fontSize: 13 }} disabled={skipReason.trim().length < 5} onClick={() => api.dialerSkip(cur.entry.id, skipReason).then(() => load(false)).catch((e) => setError(e.message))}>Saltar</button>
                        </div>
                      )}
                    </div>
                  )}
                  {cur.opportunity && cur.entry.id && <OppActions entryId={cur.entry.id} onDone={() => load(false)} onError={setError} />}
                  <button style={{ ...btnDark, height: 48, fontSize: 16 }} disabled={!cur.phone || phase === "loading" || !working || locked || (cur.campaign.dialMode === "preview" && !consulted)} onClick={() => !locked && start().catch((e) => setError(e.message))}>{!working ? "Em pausa" : locked ? "Aguarde…" : "Iniciar chamada"}</button></>
                : <div style={{ display: "flex", gap: 8 }}>
                    {viaPhone && <MuteButton muted={muted} onClick={toggleMute} />}
                    <button style={{ ...btnDark, flex: 1, height: 48, fontSize: 16, background: "#D70015", borderColor: "#D70015" }} onClick={() => hangUp()}>Desligar · {mmss(callSecs)}</button>
                  </div>}
              {phone.device?.online
                ? <span style={{ fontSize: 12, color: c.ok }}>{phase === "calling" && received ? "Chamada recebida em curso no telemóvel. Quando acabar, o resultado abre sozinho." : phase === "calling" && viaPhone ? "O telemóvel está a marcar. Quando a chamada acabar, o resultado abre sozinho." : "Telemóvel ligado: «Iniciar chamada» marca no telemóvel."} <button onClick={() => setPhoneDialog(true)} style={{ border: 0, background: "none", padding: 0, color: c.muted, textDecoration: "underline", cursor: "pointer", fontSize: 12 }}>Telemóvel</button></span>
                : <span style={{ fontSize: 12, color: c.muted }}>Marque o número no telemóvel e carregue em «Iniciar chamada». No fim, carregue no resultado (ou em «Desligar»). <button onClick={() => setPhoneDialog(true)} style={{ border: 0, background: "none", padding: 0, color: c.brand, textDecoration: "underline", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{phone.device ? "Telemóvel sem sinal" : "Emparelhar telemóvel"}</button></span>}
            </section>
          </aside>
        </div>
      )}

      {!client && cur && cat && (phase === "result" || phase === "review") && (
        <ResultPanel key={resultKey} hidden={phase === "review" || !active} needsKind={cur.company.needsKind} walletKind={cur.company.walletKind} cat={cat} group={group} onGroup={setGroup} busy={busy} error={error} endedAt={endedAt - prior * 1000}
          onOpenCompany={() => onOpenCompany(cur.company.id)}
          triedSms={cur.firstNoAnswer && smsTo ? { to: smsTo, vars: { decisor: cur.decisors[0] || undefined, empresa: cur.company.name, comercial: me.name, telemovel: me.mobile ?? undefined } } : undefined}
          onSms={(text) => { if (smsTo) api.logMessage(cur.company.id, { channel: "sms", templateId: "tried_call", to: smsTo, text }).catch((e) => setError(`SMS não enviada: ${(e as Error).message}`)); }}
          live={live ? { secs: Math.floor((Date.now() - startedAt) / 1000), queued, onHangUp: () => { hangUpLive(); } } : undefined}
          company={{ id: cur.company.id, name: cur.company.name, nif: cur.company.nif, phone: cur.phone ? formatPhone(cur.phone.value) : undefined, decisor: cur.decisors[0] }}
          onBack={() => setPhase("review")} onSave={save} />
      )}

      {!client && phase === "countdown" && (
        <section style={{ ...card, padding: 32, textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 14, color: c.muted }}>Resultado guardado: {lastSummary}</span>
          {working ? <>
            <span style={{ fontSize: 40, fontWeight: 800 }}>{left}</span>
            <span style={{ fontSize: 14 }}>{left === 0 && pauseReason ? `Em pausa: ${pauseReason}` : `Próxima empresa em ${left} s`}</span>
            <button style={btnDark} disabled={locked} onClick={() => !locked && load(true)}>{locked ? "Aguarde…" : "Ligar já"}</button>
          </> : <span style={{ fontSize: 16, fontWeight: 600 }}>Em pausa: a próxima empresa é marcada quando voltar a «A trabalhar».</span>}
        </section>
      )}

      {!client && cur && (phase === "calling") && (
        <footer style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
          {GROUPS.map((g) => (
            <button key={g.id} onClick={() => openResult(g.id)} style={{ ...btn, height: 56, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 15, ...(g.id === "sale" ? { background: c.ink, color: c.onInk, borderColor: c.ink } : {}) }}>
              {g.label}<span style={{ fontSize: 11, opacity: 0.6 }}>tecla {g.key}</span>
            </button>
          ))}
        </footer>
      )}
      {phoneDialog && <PhoneDialog onClose={() => { setPhoneDialog(false); phone.reload(); }} />}
    </div>
  );
}

const small = { ...btn, height: 28, fontSize: 12, padding: "0 10px" };
const lab = { fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase" as const, color: c.muted };

/** Script com o nome da empresa e do responsável a negrito. */
function Highlight({ text, marks }: { text: string; marks: string[] }) {
  const m = [...new Set(marks.filter((x) => x && x.length > 2))].sort((a, b) => b.length - a.length);
  if (!m.length) return <>{text}</>;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${m.map(esc).join("|")})`, "g"));
  return <>{parts.map((p, i) => (m.includes(p) ? <b key={i} style={{ fontWeight: 800 }}>{p}</b> : <span key={i}>{p}</span>))}</>;
}
function Empty({ text, action }: { text: string; action?: React.ReactNode }) {
  return <section style={{ ...card, padding: 40, textAlign: "center", color: c.muted, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>{text}{action}</section>;
}

const CB_ORANGE = "#EA580C";
const STAGE_PT: Record<string, string> = { interest: "Interesse", survey: "Levantamento", proposal: "Proposta enviada", negotiation: "Em negociação", documents: "Aguarda docs" };
const NEEDS_OP = ["proposal", "negotiation", "documents"];

/** 26 nov: callback ou follow-up de outra campanha — faixa laranja larga, para o comercial perceber de onde vem. */
function CallbackBanner({ cb }: { cb: NonNullable<DialerEntry["callback"]> }) {
  const at = cb.at ? new Date(cb.at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div role="status" style={{ background: CB_ORANGE, color: "#FFFFFF", borderRadius: 12, padding: "12px 16px", fontSize: 18, fontWeight: 800, letterSpacing: ".02em" }}>
      {cb.kind === "followup" ? "FOLLOW-UP" : "CALLBACK"}{cb.campaign ? ` · campanha ${cb.campaign}` : ""}{cb.by ? ` · marcado por ${cb.by}` : ""}{at ? ` para as ${at}` : ""}
    </div>
  );
}

/** Etiqueta «Em oportunidade · etapa · OP», com mudança de etapa (OP pedida a partir de Proposta). */
function OppBadge({ o, onChanged, onError }: { o: NonNullable<DialerEntry["opportunity"]>; onChanged: () => void; onError: (m: string) => void }) {
  const [stage, setStage] = useState(o.stage);
  const [op, setOp] = useState("");
  const askOp = NEEDS_OP.includes(stage) && !o.nosOp && stage !== o.stage;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12, fontWeight: 700, background: c.brandSoft, borderRadius: 999, padding: "4px 6px 4px 12px" }}>
      Em oportunidade{o.nosOp ? ` · OP ${o.nosOp}` : ""} ·
      <select aria-label="Etapa da oportunidade" value={stage} onChange={(e) => setStage(e.target.value)} style={{ ...input, height: 28, fontSize: 12, padding: "0 6px" }}>
        {Object.entries(STAGE_PT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {askOp && <input aria-label="OP" inputMode="numeric" maxLength={7} placeholder="OP" value={op} onChange={(e) => setOp(e.target.value.replace(/\D/g, ""))} style={{ ...input, height: 28, width: 90, fontSize: 12 }} />}
      {stage !== o.stage && <button type="button" style={{ ...btnDark, height: 28, fontSize: 12, padding: "0 10px" }} disabled={askOp && op.length !== 7}
        onClick={() => api.moveOpportunity(o.id, stage, "Mudada no Ligar", askOp ? op : undefined).then(onChanged).catch((e) => onError(e.message))}>Mudar etapa</button>}
    </span>
  );
}

/** Empresa em oportunidade: Saltar (sem resultado nem tentativa) e Follow-up (sai da fila até à hora marcada). */
function OppActions({ entryId, onDone, onError }: { entryId: string; onDone: () => void; onError: (m: string) => void }) {
  const [fu, setFu] = useState(false);
  const [at, setAt] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" style={{ ...btn, flex: 1, height: 38 }} onClick={() => api.dialerSkip(entryId, "Em oportunidade").then(onDone).catch((e) => onError(e.message))}>Saltar</button>
        <button type="button" style={{ ...btn, flex: 1, height: 38, borderColor: CB_ORANGE, color: CB_ORANGE }} onClick={() => setFu(!fu)}>Follow-up</button>
      </div>
      {fu && <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <DatePicker withTime workdaysOnly value={at} onChange={setAt} width={220} ariaLabel="Follow-up: data e hora" min={new Date().toISOString().slice(0, 10)} />
        <button type="button" style={{ ...btnDark, height: 38 }} disabled={!at} onClick={() => api.dialerFollowUp(entryId, new Date(at).toISOString()).then(onDone).catch((e) => onError(e.message))}>Marcar follow-up</button>
      </div>}
    </div>
  );
}

/** A chamada que entrou é da mesma empresa do script (mesmo número ou número dessa empresa)? */
function sameAsScript(inc: { number?: string | null; companyIds?: string[] }, cur: DialerEntry) {
  const n = (x?: string | null) => (x ?? "").replace(/\D/g, "").slice(-9);
  if (inc.number && cur.phone && n(inc.number) === n(cur.phone.value)) return true;
  return !!inc.companyIds?.includes(cur.company.id) && (inc.companyIds?.length ?? 0) === 1;
}

/** Mesma conversa: fecha sozinho a janela da recebida e continua a chamada do script. */
function SameCall({ id, onSame }: { id: string; onSame: () => void }) {
  useEffect(() => { onSame(); }, [id]);
  return null;
}
