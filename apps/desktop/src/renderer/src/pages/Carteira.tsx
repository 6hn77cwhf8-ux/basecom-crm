import { useEffect, useState } from "react";
import { DEFAULT_SCRIPTS, formatPhone, renderScript } from "@basecom/shared";
import { api, type Catalogs, type ResultInput, type User, type WalletRow } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, fmtDate, input, PageHeader, td, th } from "../ui";
import { NewTask } from "./Agenda";
import { ResultPanel, type Group } from "./ResultPanel";

/**
 * C2C / Carteira (maqueta 9): a carteira do comercial com «Ligar» em cada empresa.
 * Ligar abre o script e, no fim, o resultado, sem sair da Carteira. O aviso de chamada a entrar chega com a app Android.
 */
export function Carteira({ me, onOpenCompany }: { me: User; onOpenCompany: (id: string) => void }) {
  // Administrador: todos; Chefe de Equipa: a sua equipa (o servidor limita).
  const isAdmin = me.role !== "sales";
  const [rows, setRows] = useState<WalletRow[] | null>(null);
  const [owner, setOwner] = useState("");
  const [tasks, setTasks] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [cat, setCat] = useState<Catalogs | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [calling, setCalling] = useState<{ r: WalletRow; callId: string; phone: string; ended: number | null; group: Group } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { const t = setTimeout(() => setQuery(q), 250); return () => clearTimeout(t); }, [q]);
  const load = () => api.wallet({ ownerId: owner || undefined, tasks: tasks || undefined, q: query || undefined }).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [owner, tasks, query]);
  useEffect(() => { api.catalogs().then(setCat).catch(() => undefined); if (isAdmin) api.agendaPeople().then(setPeople).catch(() => undefined); }, []);

  async function call(r: WalletRow) {
    setError("");
    try { const x = await api.callFromWallet(r.id); setCalling({ r, callId: x.callId, phone: x.phone.value, ended: null, group: "callback" }); }
    catch (e) { setError((e as Error).message); }
  }
  async function save(res: ResultInput) {
    if (!calling) return;
    setBusy(true); setError("");
    try { await api.saveResult(calling.callId, res); setCalling(null); load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (calling && cat) {
    const r = calling.r;
    const script = renderScript(DEFAULT_SCRIPTS.opening, { comercial: me.name, empresa: r.name, decisor: r.decisor ?? "" });
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
        <PageHeader eyebrow="C2C / Carteira · chamada" title={r.name} actions={<button style={btn} onClick={() => onOpenCompany(r.id)}>Abrir ficha</button>} />
        {calling.ended === null ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 12 }}>
            <section style={{ ...card, padding: "24px 32px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>Script</span>
              <p style={{ fontSize: 22, lineHeight: "32px", margin: "10px 0 0" }}>{script}</p>
            </section>
            <section style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <b style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}><a href={`tel:+351${calling.phone}`} style={{ color: c.ink }}>{formatPhone(calling.phone)}</a></b>
              <span style={{ fontSize: 13, color: c.muted }}>{r.decisor ?? "Sem decisor"} · {r.lines} linhas</span>
              <button style={{ ...btnDark, height: 48, background: "#D70015", borderColor: "#D70015" }} onClick={async () => { await api.endCall(calling.callId).catch(() => undefined); setCalling({ ...calling, ended: Date.now() }); }}>Desligar</button>
            </section>
          </div>
        ) : (
          <ResultPanel cat={cat} group={calling.group} onGroup={(g) => setCalling({ ...calling, group: g })} busy={busy} error={error} endedAt={calling.ended}
            company={{ name: r.name, nif: r.nif, phone: formatPhone(calling.phone), decisor: r.decisor ?? undefined }}
            onBack={() => setCalling({ ...calling, ended: null })} onSave={save} />
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  const active = !!(owner || tasks || q);
  return (
    <>
      <PageHeader eyebrow="Trabalho comercial" title="C2C / Carteira" actions={<button style={btnDark} onClick={() => setNewTask(true)}>Nova tarefa</button>} />
      <section style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: `1px solid ${c.line}`, alignItems: "center", flexWrap: "wrap" }}>
          <input style={{ ...input, height: 36, flex: "1 1 240px" }} placeholder="Pesquisar por nome, NIF ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          {isAdmin && <select aria-label="Carteira de" style={{ ...input, height: 36 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Carteira de: todos</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <select aria-label="Tarefas" style={{ ...input, height: 36 }} value={tasks} onChange={(e) => setTasks(e.target.value)}>
            <option value="">Tarefas: todas</option><option value="with">Com tarefas</option><option value="late">Com tarefas atrasadas</option><option value="without">Sem tarefas</option>
          </select>
          <span style={{ fontSize: 13, color: c.muted, marginLeft: "auto" }}>{rows ? `${rows.length} empresas` : "A carregar…"}</span>
          {active && <button style={{ ...btn, height: 36 }} onClick={() => { setOwner(""); setTasks(""); setQ(""); }}>Limpar</button>}
        </div>
        <ErrorText>{error}</ErrorText>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#FAFAFA", color: c.muted }}>
              {["Empresa", "Decisor", "Telefone", "", "Linhas", "Próxima ação", "Último contacto", "Tarefas", ...(isAdmin && !owner ? ["Carteira"] : [])].map((h, i) => <th key={i} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows?.map((r) => {
                const late = r.nextAction && new Date(r.nextAction.dueAt) < new Date();
                return (
                  <tr key={r.id}>
                    <td style={td}><button onClick={() => onOpenCompany(r.id)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: 13, textAlign: "left", color: c.ink, fontFamily: "inherit" }}>{r.name}</button> <Chip tone={r.walletKind === "FC" ? "warn" : "neutral"}>{r.walletKind}</Chip></td>
                    <td style={td}>{r.decisor ?? <span style={{ color: c.muted }}>—</span>}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.phone ? formatPhone(r.phone) : <span style={{ color: c.muted }}>Sem telefone</span>}</td>
                    <td style={td}><button style={{ ...btnDark, height: 30, fontSize: 12, padding: "0 12px" }} disabled={!r.phone || (!isAdmin && false)} onClick={() => call(r)}>Ligar</button></td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.lines || "—"}</td>
                    <td style={{ ...td, color: late ? "#A1000F" : c.ink }}>{r.nextAction ? `${r.nextAction.type} · ${fmtDate(r.nextAction.dueAt)}` : <span style={{ color: c.muted }}>—</span>}</td>
                    <td style={td}>{r.lastContact ? fmtDate(r.lastContact) : <span style={{ color: c.muted }}>—</span>}</td>
                    <td style={{ ...td, textAlign: "right" }}>{r.openTasks || "—"}</td>
                    {isAdmin && !owner && <td style={td}>{r.owner}</td>}
                  </tr>
                );
              })}
              {rows?.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: c.muted, padding: 32 }}>{active ? "Nenhum resultado com estes filtros." : "Ainda não há empresas nesta carteira. Uma empresa entra na carteira na primeira venda ou por transferência do Administrador."}</td></tr>}
            </tbody>
          </table>
        </div>
        <p style={{ margin: 0, padding: "10px 14px", fontSize: 12, color: c.muted }}>«Ligar» abre o script sem sair da Carteira. Carregue no nome para abrir a ficha. O aviso de chamada a entrar chega com a app Android.</p>
      </section>
      {newTask && cat && <NewTask types={cat.catalogs.taskTypes} me={me} people={people} onClose={() => setNewTask(false)} onDone={() => { setNewTask(false); load(); }} />}
    </>
  );
}
