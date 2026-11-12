import { useEffect, useMemo, useState } from "react";
import { formatPhone } from "@basecom/shared";
import { api, type AgendaTask, type Catalogs, type ResultInput, type SearchHit, type User } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, Field, input, PageHeader } from "../ui";
import { Modal } from "./Wallet";
import { ResultPanel, type Group } from "./ResultPanel";

const ORIGIN: Record<string, string> = { call: "da chamada", manual: "manual" };
const hm = (iso: string) => new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit" });
/** «AAAA-MM-DDTHH:MM» local para um campo datetime-local. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * Agenda (Fase 3, passo 5): tarefas atrasadas, de hoje, de amanhã e dos próximos dias.
 * «Ligar» faz a chamada a partir da tarefa; ao guardar o resultado, a tarefa fica concluída.
 */
export function Agenda({ me, onOpenCompany }: { me: User; onOpenCompany: (id: string) => void }) {
  // Administrador: todos; Chefe de Equipa: a sua equipa (o servidor limita).
  const isAdmin = me.role !== "sales";
  const [rows, setRows] = useState<AgendaTask[] | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [who, setWho] = useState(isAdmin ? "" : me.id);
  const [cat, setCat] = useState<Catalogs | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "reschedule" | "cancel"; t: AgendaTask } | null>(null);
  const [calling, setCalling] = useState<{ t: AgendaTask; callId: string; phone: string | null; ended: number | null; group: Group; needsKind: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.agenda(isAdmin ? who || undefined : undefined).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [who]);
  useEffect(() => {
    api.catalogs().then(setCat).catch(() => undefined);
    if (isAdmin) api.agendaPeople().then(setPeople).catch(() => undefined);
  }, []);

  const groups = useMemo(() => {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const tomorrow = new Date(start.getTime() + 86400_000);
    const after = new Date(start.getTime() + 2 * 86400_000);
    const g: [string, AgendaTask[], boolean][] = [["Atrasadas", [], true], ["Hoje", [], false], ["Amanhã", [], false], ["Próximos dias", [], false]];
    for (const t of rows ?? []) {
      const d = new Date(t.dueAt);
      g[d < now ? 0 : d < tomorrow ? 1 : d < after ? 2 : 3]![1].push(t);
    }
    return g;
  }, [rows]);

  async function startCall(t: AgendaTask) {
    setError("");
    try {
      const [r, co] = await Promise.all([api.callFromTask(t.id), api.company(t.companyId)]);
      const needsKind = co.company.accountType === "client" && !co.company.ownerId && !co.company.walletKindConfirmed;
      setCalling({ t, callId: r.callId, phone: r.phone?.value ?? null, ended: null, group: "callback", needsKind });
    } catch (e) { setError((e as Error).message); }
  }
  async function hangUp() {
    if (!calling) return;
    await api.endCall(calling.callId).catch(() => undefined);
    setCalling({ ...calling, ended: Date.now() });
  }
  async function save(r: ResultInput) {
    if (!calling) return;
    setBusy(true); setError("");
    try {
      await api.saveResult(calling.callId, r);
      await api.closeTask(calling.t.id, "done", "resultado registado na chamada").catch(() => undefined);
      setCalling(null); load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (calling && cat) {
    const t = calling.t;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
        <PageHeader eyebrow="Agenda · chamada" title={t.company} />
        {calling.ended === null ? (
          <section style={{ ...card, padding: 24, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, color: c.muted }}>{t.type}{t.description ? ` · ${t.description}` : ""}</span>
              <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{calling.phone ? <a href={`tel:+351${calling.phone}`} style={{ color: c.ink }}>{formatPhone(calling.phone)}</a> : "Sem telefone válido"}</span>
              <span style={{ fontSize: 12, color: c.muted }}>Marque o número no telemóvel (ou clique nele). No fim, carregue em «Desligar».</span>
            </div>
            <button style={btn} onClick={() => onOpenCompany(t.companyId)}>Abrir ficha</button>
            <button style={{ ...btnDark, height: 48, padding: "0 28px", background: "#D70015", borderColor: "#D70015" }} onClick={hangUp}>Desligar</button>
          </section>
        ) : (
          <ResultPanel cat={cat} group={calling.group} onGroup={(g) => setCalling({ ...calling, group: g })} busy={busy} error={error} endedAt={calling.ended}
            needsKind={calling.needsKind} company={{ name: t.company, nif: t.nif, phone: calling.phone ? formatPhone(calling.phone) : undefined }}
            onBack={() => setCalling({ ...calling, ended: null })} onSave={save} />
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Trabalho comercial" title="Agenda" actions={<>
        {isAdmin && (
          <select aria-label="Agenda de" style={{ ...input, height: 38, width: 220 }} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Todas as pessoas</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.id === me.id ? "A minha agenda" : p.name}</option>)}
          </select>
        )}
        <button style={btnDark} onClick={() => setDialog({ kind: "new" })}>Nova tarefa</button>
      </>} />
      <ErrorText>{error}</ErrorText>
      {rows?.length === 0 && <section style={{ ...card, padding: 32, textAlign: "center", color: c.muted }}>Sem tarefas por fazer. Os callbacks «Agendar para mim», as próximas ações das propostas e os seguimentos aparecem aqui.</section>}
      {groups.filter(([, l]) => l.length).map(([title, list, late]) => (
        <section key={title} style={{ ...card, overflow: "hidden", ...(late ? { borderColor: "#D70015" } : {}) }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${c.line}`, display: "flex", gap: 8, alignItems: "center" }}>
            <b style={{ fontSize: 15, color: late ? "#A1000F" : c.ink }}>{title}</b><Chip tone={late ? "bad" : "neutral"}>{list.length}</Chip>
          </div>
          {list.map((t) => (
            <div key={t.id} style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 16, alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${c.line}`, fontSize: 14 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <b style={{ fontVariantNumeric: "tabular-nums", color: late ? "#A1000F" : c.ink }}>{hm(t.dueAt)}</b>
                <span style={{ fontSize: 12, color: c.muted }}>{day(t.dueAt)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Chip tone="brand">{t.type}</Chip>
                  <button onClick={() => onOpenCompany(t.companyId)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: 14, color: c.ink, textAlign: "left" }}>{t.company}</button>
                  {t.phone && <span style={{ color: c.muted, fontVariantNumeric: "tabular-nums" }}>{formatPhone(t.phone)}</span>}
                </span>
                <span style={{ fontSize: 13, color: c.muted }}>{t.description ?? "—"} · {ORIGIN[t.origin] ?? t.origin}{isAdmin && !who ? ` · ${t.assignedName}` : ""}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(t.assignedTo === me.id) && <button style={{ ...btnDark, height: 32, fontSize: 13 }} disabled={!t.phone} title={t.phone ? "Ligar e registar o resultado" : "Sem telefone válido"} onClick={() => startCall(t)}>Ligar</button>}
                <button style={small} onClick={() => api.closeTask(t.id, "done").then(load).catch((e) => setError(e.message))}>Concluir</button>
                <button style={small} onClick={() => setDialog({ kind: "reschedule", t })}>Reagendar</button>
                <button style={{ ...small, color: "#A1000F" }} onClick={() => setDialog({ kind: "cancel", t })}>Cancelar</button>
              </div>
            </div>
          ))}
        </section>
      ))}
      {dialog?.kind === "reschedule" && <Reschedule t={dialog.t} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.kind === "cancel" && <CancelTask t={dialog.t} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.kind === "new" && cat && <NewTask types={cat.catalogs.taskTypes} me={me} people={people} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
    </>
  );
}

const small = { ...btn, height: 32, fontSize: 13, padding: "0 12px" };

function Reschedule({ t, onClose, onDone }: { t: AgendaTask; onClose: () => void; onDone: () => void }) {
  const [at, setAt] = useState(localInput(new Date(Math.max(Date.now(), new Date(t.dueAt).getTime()) + 86400_000)));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title={`Reagendar «${t.type}» · ${t.company}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Nova data e hora"><input style={input} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        <Field label="Justificação (fica no histórico da empresa)"><input style={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente pediu para ligar na próxima semana" /></Field>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={btnDark} disabled={!at || reason.trim().length < 5} onClick={() => api.rescheduleTask(t.id, new Date(at).toISOString(), reason).then(onDone).catch((e) => setErr(e.message))}>Reagendar</button>
        </div>
      </div>
    </Modal>
  );
}

function CancelTask({ t, onClose, onDone }: { t: AgendaTask; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title={`Cancelar «${t.type}» · ${t.company}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Porque cancela (fica no histórico da empresa)"><input style={input} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={{ ...btnDark, background: "#A1000F", borderColor: "#A1000F" }} disabled={note.trim().length < 5} onClick={() => api.closeTask(t.id, "cancelled", note).then(onDone).catch((e) => setErr(e.message))}>Cancelar tarefa</button>
        </div>
      </div>
    </Modal>
  );
}

export function NewTask({ types, me, people, onClose, onDone }: { types: string[]; me: User; people: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [company, setCompany] = useState<SearchHit | null>(null);
  const [type, setType] = useState(types[0] ?? "Ligar");
  const [at, setAt] = useState(localInput(new Date(Date.now() + 3600_000)));
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState(me.id);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (company || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api.search(q).then(setHits).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [q, company]);
  return (
    <Modal title="Nova tarefa" onClose={onClose} width={600}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Empresa">
          {company ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b style={{ flex: 1 }}>{company.name} · {company.nif}</b><button style={small} onClick={() => { setCompany(null); setQ(""); }}>Mudar</button></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <input style={input} autoFocus placeholder="NIF, nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
              {hits.map((h) => <button key={h.id} style={{ ...btn, height: 34, textAlign: "left", fontWeight: 500 }} onClick={() => setCompany(h)}>{h.name} · {h.nif}{h.municipality ? ` · ${h.municipality}` : ""}</button>)}
            </div>
          )}
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Tipo"><select style={input} value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Data e hora"><input style={input} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        </div>
        {me.role === "admin" && people.length > 0 && (
          <Field label="Para"><select style={input} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>{people.map((p) => <option key={p.id} value={p.id}>{p.id === me.id ? "Mim" : p.name}</option>)}</select></Field>
        )}
        <Field label="Descrição"><input style={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: enviar proposta 4P" /></Field>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={btnDark} disabled={!company || !at} onClick={() => api.createTask({ companyId: company!.id, type, dueAt: new Date(at).toISOString(), description: description || undefined, assignedTo }).then(onDone).catch((e) => setErr(e.message))}>Criar tarefa</button>
        </div>
      </div>
    </Modal>
  );
}
