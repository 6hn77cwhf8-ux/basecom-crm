import { useEffect, useState } from "react";
import { api, type Role } from "../api";
import { btn, btnDark, c, card, ErrorText, Field, input } from "../ui";
import { Modal } from "./Wallet";

type Team = { id: string; name: string; leadId: string | null; leadName: string | null; members: { id: string; name: string }[] };
type Person = { id: string; name: string; role: Role; active: boolean };

/**
 * Configurações → Equipas: cada equipa tem um Chefe de Equipa e os seus comerciais.
 * O Chefe vê os tempos, agendas, carteiras e oportunidades da sua equipa e recebe os avisos dela.
 */
export function TeamsSettings() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const [error, setError] = useState("");
  const load = () => api.teams().then(setTeams).catch((e) => setError(e.message));
  useEffect(() => { load(); api.users().then((u) => setPeople(u.filter((x) => x.active) as Person[])).catch(() => undefined); }, []);
  const leads = people.filter((p) => p.role === "team_lead");
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 16 }}>Equipas</b>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: c.muted }}>O Chefe de Equipa vê os tempos, a agenda, a carteira e as oportunidades da sua equipa e recebe os avisos dela (ex.: resultado registado fora do prazo). Sem equipa, os avisos vão para o Administrador.</p>
        </div>
        <button style={btnDark} onClick={() => setEditing("new")}>Nova equipa</button>
      </div>
      <ErrorText>{error}</ErrorText>
      {leads.length === 0 && <p style={{ ...card, margin: 0, padding: 14, fontSize: 13, color: "#8A3D00", background: "#FFF4E5" }}>Ainda ninguém tem o perfil «Chefe de Equipa». Mude o perfil em Equipa comercial (coluna Perfil) e volte aqui.</p>}
      {teams?.length === 0 && <p style={{ ...card, margin: 0, padding: 24, textAlign: "center", color: c.muted }}>Ainda não há equipas.</p>}
      {teams?.map((t) => (
        <article key={t.id} style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 15 }}>{t.name}</b>
            <div style={{ fontSize: 13, color: c.muted }}>Chefe: {t.leadName ?? "—"} · Comerciais: {t.members.map((m) => m.name).join(", ") || "—"}</div>
          </div>
          <button style={{ ...btn, height: 30, fontSize: 12 }} onClick={() => setEditing(t)}>Editar</button>
          <button style={{ ...btn, height: 30, fontSize: 12, color: "#A1000F" }} onClick={() => confirm(`Apagar a equipa «${t.name}»? Os comerciais ficam sem equipa.`) && api.deleteTeam(t.id).then(load).catch((e) => setError(e.message))}>Apagar</button>
        </article>
      ))}
      {editing && <TeamForm team={editing === "new" ? null : editing} people={people} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </section>
  );
}

function TeamForm({ team, people, onClose, onSaved }: { team: Team | null; people: Person[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(team?.name ?? "");
  const [leadId, setLeadId] = useState(team?.leadId ?? "");
  const [members, setMembers] = useState<string[]>(team?.members.map((m) => m.id) ?? []);
  const [err, setErr] = useState("");
  const save = () => (team ? api.updateTeam(team.id, { name, leadId: leadId || null, memberIds: members }) : api.createTeam({ name, leadId: leadId || null, memberIds: members })).then(onSaved).catch((e) => setErr(e.message));
  return (
    <Modal title={team ? `Editar «${team.name}»` : "Nova equipa"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Nome"><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Equipa Porto" /></Field>
        <Field label="Chefe de Equipa">
          <select style={input} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Sem chefe</option>{people.filter((p) => p.role === "team_lead").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Comerciais">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {people.filter((p) => p.role === "sales").map((p) => {
              const on = members.includes(p.id);
              return <button key={p.id} type="button" onClick={() => setMembers(on ? members.filter((x) => x !== p.id) : [...members, p.id])} style={{ ...btn, height: 30, fontSize: 12, background: on ? c.ink : c.card, color: on ? "#FFF" : c.ink }}>{p.name}</button>;
            })}
          </div>
        </Field>
        <span style={{ fontSize: 12, color: c.muted }}>Um comercial só pertence a uma equipa: se já estiver noutra, passa para esta.</span>
        <ErrorText>{err}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onClose}>Voltar</button>
          <button style={btnDark} disabled={name.trim().length < 2} onClick={save}>Guardar</button>
        </div>
      </div>
    </Modal>
  );
}
