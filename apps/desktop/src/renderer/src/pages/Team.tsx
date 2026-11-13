import { useEffect, useState, type FormEvent } from "react";
import { fmtBalance } from "@basecom/shared";
import { api, ROLE_LABEL, type Role, type TeamMember, type User } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, Field, fmtDate, input, PageHeader, td, th } from "../ui";
import { mmss, STATE_LABEL } from "./WorkState";
import type { DaySummary } from "../api";

export function Team({ me }: { me: User }) {
  const isAdmin = me.role === "admin";
  const [list, setList] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);

  const load = () => api.users().then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try { await fn(); await load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <PageHeader eyebrow="Utilizadores e perfis" title="Equipa comercial"
        actions={isAdmin && <button style={btnDark} onClick={() => setCreating(true)}>Novo utilizador</button>} />
      {secret && (
        <section role="status" style={{ ...card, padding: 16, borderColor: c.brand, background: "#FFF8F3", display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <b>Palavra-passe provisória de {secret.who}:</b> <code style={{ fontSize: 16, padding: "2px 8px", background: c.card, borderRadius: 6 }}>{secret.password}</code>
            <div style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Entregue-a à pessoa. Não volta a ser mostrada. Na primeira entrada, a pessoa escolhe uma nova e ativa o Microsoft Authenticator.</div>
          </div>
          <button style={btn} onClick={() => setSecret(null)}>Fechar</button>
        </section>
      )}
      {creating && <NewUser onCancel={() => setCreating(false)} onCreated={(who, password) => { setCreating(false); setSecret({ who, password }); load(); }} />}
      <ErrorText>{error}</ErrorText>
      <section style={{ ...card, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#FAFAFA", color: c.muted, textAlign: "left" }}>
            {["Nome", "Perfil", "Email", "Admissão", "Estado", "2FA", ...(isAdmin ? [""] : [])].map((h) => <th key={h} style={{ padding: "10px 12px", fontWeight: 600, borderBottom: `1px solid ${c.line}` }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} style={{ borderBottom: `1px solid ${c.line}`, opacity: u.active ? 1 : 0.55 }}>
                <td style={{ padding: "10px 12px", fontWeight: 600 }}>{u.name}</td>
                <td style={{ padding: "10px 12px" }}>
                  {isAdmin && u.id !== me.id ? (
                    <select aria-label={`Perfil de ${u.name}`} style={{ ...input, height: 32 }} value={u.role} onChange={(e) => act(() => api.updateUser(u.id, { role: e.target.value as Role }))}>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : <Chip tone={u.role === "admin" ? "brand" : "neutral"}>{ROLE_LABEL[u.role]}</Chip>}
                </td>
                <td style={{ padding: "10px 12px" }}>{u.email}</td>
                <td style={{ padding: "10px 12px" }}>{fmtDate(u.hiredAt)}</td>
                <td style={{ padding: "10px 12px" }}>{!u.active ? <Chip>Inativo</Chip> : u.locked ? <Chip tone="bad">Bloqueado</Chip> : u.mustChangePassword ? <Chip tone="warn">Por ativar</Chip> : <Chip tone="ok">Ativo</Chip>}</td>
                <td style={{ padding: "10px 12px" }}>{u.totpEnabled ? <Chip tone="ok">Ativa</Chip> : <Chip tone="warn">Por ativar</Chip>}</td>
                {isAdmin && (
                  <td style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {u.id !== me.id && <>
                      <button style={{ ...btn, height: 30, fontSize: 12, marginLeft: 6 }} onClick={() => act(async () => { const r = await api.resetPassword(u.id); setSecret({ who: u.name, password: r.tempPassword }); })}>Repor palavra-passe</button>
                      <button style={{ ...btn, height: 30, fontSize: 12, marginLeft: 6 }} title="Telemóvel perdido ou trocado" onClick={() => act(() => api.resetTotp(u.id))}>Repor 2FA</button>
                      <button style={{ ...btn, height: 30, fontSize: 12, marginLeft: 6 }} onClick={() => act(() => api.updateUser(u.id, { active: !u.active }))}>{u.active ? "Desativar" : "Reativar"}</button>
                    </>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p style={{ margin: 0, fontSize: 12, color: c.muted }}>Desativar não apaga o histórico; termina as sessões abertas. Cada alteração fica na auditoria.</p>
      {me.role !== "sales" && <Ponto />}
    </>
  );
}

function NewUser({ onCancel, onCreated }: { onCancel: () => void; onCreated: (who: string, password: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("sales");
  const [hiredAt, setHiredAt] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    try { const r = await api.createUser({ name, email, role, hiredAt: hiredAt || null }); onCreated(name, r.tempPassword); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <form onSubmit={submit} style={{ ...card, padding: 18, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, alignItems: "end" }}>
      <Field label="Nome"><input style={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus /></Field>
      <Field label="Email"><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="Perfil"><select style={input} value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
      <Field label="Data de admissão"><input style={input} type="date" value={hiredAt} onChange={(e) => setHiredAt(e.target.value)} /></Field>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        <ErrorText>{error}</ErrorText>
        <button type="button" style={btn} onClick={onCancel}>Cancelar</button>
        <button style={btnDark}>Criar utilizador</button>
      </div>
    </form>
  );
}

/**
 * Ponto · hoje: o almoço é reconhecido pela saída e reentrada no CRM; presença = manhã + tarde; saldo face às horas previstas
 * (Configurações → Limites de tempo). O Chefe de Equipa vê a sua equipa; o Administrador toda a estrutura.
 */
function Ponto() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.teamTime>> | null>(null);
  const [error, setError] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const load = () => api.teamTime().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);
  const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "—");
  const red = (on: boolean) => (on ? { color: "#D70015", fontWeight: 700 } : {});
  return (
    <section style={{ ...card, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${c.line}`, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 16 }}>Ponto · hoje</b>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: c.muted }}>Entrada e saída pelo login. Ao sair para almoço, saia do CRM; ao voltar, entre de novo. Saldo face às horas previstas do dia (Configurações → Limites de tempo).</p>
        </div>
        <input type="date" aria-label="De" style={{ ...input, height: 34, width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" aria-label="Até" style={{ ...input, height: 34, width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <button style={{ ...btn, height: 34 }} onClick={() => api.exportPonto(from, to).catch((e) => setError(e.message))}>Exportar Excel</button>
      </div>
      <ErrorText>{error}</ErrorText>
      <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ background: "#FAFAFA", color: c.muted }}>{["Nome", "Agora", "Entrada", "Saída almoço", "Regresso", "Saída", "Presença", "Saldo", "Saída prevista", "Intervalo", "Formação", "Recebidas · por retribuir", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows?.map((r) => {
          const p = r.ponto;
          return (
            <tr key={r.id}>
              <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
              <td style={td}>{r.state ? <Chip tone={r.state === "working" ? "ok" : "warn"}>{STATE_LABEL[r.state]}</Chip> : <span style={{ color: c.muted }}>Fora</span>}</td>
              <td style={td}>{hm(p.entrada)}</td><td style={td}>{hm(p.saidaAlmoco)}</td><td style={td}>{hm(p.regressoAlmoco)}</td><td style={td}>{hm(p.saida)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{mmss(p.presenceSeconds)}</td>
              <td style={{ ...td, fontWeight: 700, color: p.balanceSeconds < 0 ? "#A1000F" : "#1E6F33" }}>{fmtBalance(p.balanceSeconds)}</td>
              <td style={td}>{hm(p.expectedExit)}</td>
              <td style={{ ...td, ...red(r.over.break) }}>{mmss(r.seconds.break)}</td>
              <td style={{ ...td, ...red(r.over.training) }}>{mmss(r.seconds.training)}</td>
              <td style={td}>{r.incoming.received} · <span style={red(r.incoming.toReturn > 0)}>{r.incoming.toReturn}</span>{r.incoming.returned ? ` (${r.incoming.returned} retribuídas)` : ""}</td>
              <td style={{ ...td, textAlign: "right" }}>{r.state && r.state !== "training" && <button style={{ ...btn, height: 28, fontSize: 12 }} onClick={() => api.setWorkState("training", r.id).then(load).catch((e) => setError(e.message))}>Pôr em formação</button>}</td>
            </tr>
          );
        })}</tbody>
      </table>
      </div>
    </section>
  );
}
