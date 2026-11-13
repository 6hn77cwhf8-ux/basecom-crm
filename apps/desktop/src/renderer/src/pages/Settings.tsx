import { useEffect, useState } from "react";
import { api, type AuditEntry, type Settings as S } from "../api";
import { btn, btnDark, c, card, ErrorText, fmtDateTime, input, PageHeader } from "../ui";
import { Campaigns } from "./Campaigns";
import { CatalogSettings } from "./CatalogSettings";
import { TeamsSettings } from "./TeamsSettings";

type Section = "timeLimits" | "catalogs" | "campaigns" | "teams" | "auth" | "audit";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "timeLimits", label: "Limites de tempo" },
  { id: "catalogs", label: "Catálogos (resultados, motivos, prazos)" },
  { id: "campaigns", label: "Campanhas e scripts" },
  { id: "teams", label: "Equipas" },
  { id: "auth", label: "Segurança e entrada" },
  { id: "audit", label: "Histórico de auditoria" },
];

const FIELDS: { [K in keyof S]: { key: keyof S[K]; label: string; unit: string; note?: string }[] } = {
  timeLimits: [
    { key: "resultSeconds", label: "Registar o resultado após a chamada", unit: "s", note: "Se ultrapassar, o Chefe de Equipa é avisado" },
    { key: "nextCallSeconds", label: "Espera até marcar a empresa seguinte", unit: "s" },
    { key: "campaignSwitchMinutes", label: "Pausa para mudar de campanha", unit: "min/dia" },
    { key: "trainingMinutes", label: "Formação por iniciativa do comercial", unit: "min/dia", note: "O Chefe de Equipa ou o Administrador pode marcar mais" },
    { key: "breakMinutes", label: "Intervalo", unit: "min/dia", note: "Se ultrapassar, o Administrador é avisado" },
    { key: "dailyMinutes", label: "Horas previstas (segunda a sexta)", unit: "min/dia", note: "Para o saldo do ponto (480 = 8 h). O almoço não conta" },
    { key: "saturdayMinutes", label: "Horas previstas ao sábado", unit: "min", note: "255 = 4 h 15 (08:45–13:00)" },
  ],
  auth: [
    { key: "maxFailedLogins", label: "Tentativas erradas antes de bloquear", unit: "vezes" },
    { key: "lockMinutes", label: "Tempo de bloqueio", unit: "min" },
    { key: "sessionHours", label: "Duração de uma sessão", unit: "horas" },
  ],
};

export function Settings() {
  const [section, setSection] = useState<Section>("timeLimits");
  return (
    <>
      <PageHeader eyebrow="Tudo configurável pelo Administrador" title="Configurações" />
      <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <nav aria-label="Secções de configuração" style={{ ...card, padding: 8, display: "flex", flexDirection: "column", gap: 1 }}>
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => setSection(s.id)} style={{ fontFamily: "inherit", textAlign: "left", border: 0, padding: "8px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", color: c.ink, background: section === s.id ? c.brandSoft : "transparent", fontWeight: section === s.id ? 600 : 400, boxShadow: section === s.id ? `inset 3px 0 0 ${c.brand}` : "none" }}>{s.label}</button>
          ))}
          <span style={{ fontSize: 12, color: c.muted, padding: "8px 12px" }}>As restantes secções (ciclos, comissões…) chegam com o Arranque B.</span>
        </nav>
        {section === "audit" ? <Audit /> : section === "catalogs" ? <CatalogSettings /> : section === "teams" ? <TeamsSettings /> : section === "campaigns" ? <Campaigns /> : <Limits key={section} kind={section} />}
      </div>
    </>
  );
}

function Limits({ kind }: { kind: keyof S }) {
  const [value, setValue] = useState<Record<string, number> | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.settings().then((s) => setValue({ ...s[kind] })).catch((e) => setError(e.message)); }, [kind]);
  if (!value) return <ErrorText>{error}</ErrorText>;

  async function save() {
    setError(""); setSaved(false);
    try { await api.saveSetting(kind, value as never); setSaved(true); } catch (e) { setError((e as Error).message); }
  }
  return (
    <section style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 4 }}>
      <b style={{ fontSize: 16 }}>{SECTIONS.find((s) => s.id === kind)!.label}</b>
      {FIELDS[kind].map((f) => (
        <div key={String(f.key)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${c.line}`, fontSize: 14 }}>
          <span>{f.label}{f.note && <span style={{ display: "block", fontSize: 12, color: c.muted }}>{f.note}</span>}</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="number" min={0} aria-label={f.label} style={{ ...input, width: 80, textAlign: "right" }} value={value[f.key as string]} onChange={(e) => { setSaved(false); setValue({ ...value, [f.key]: Number(e.target.value) }); }} />
            <span style={{ fontSize: 12, color: c.muted, width: 56 }}>{f.unit}</span>
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", paddingTop: 12 }}>
        {saved && <span role="status" style={{ color: c.ok, fontSize: 13, fontWeight: 600 }}>Guardado e registado na auditoria.</span>}
        <ErrorText>{error}</ErrorText>
        <button style={btnDark} onClick={save}>Guardar alterações</button>
      </div>
    </section>
  );
}

const ACTIONS: Record<string, string> = {
  importacao_carregada: "Importação: ficheiro carregado", importacao_gravada: "Importação gravada", importacao_anulada: "Importação anulada", importacao_cancelada: "Importação cancelada",
  carteira_nc_fc_alterada: "NC/FC alterado", carteira_nc_fc_identificada: "NC/FC identificado", contacto_estado_alterado: "Contacto: estado alterado", contacto_acrescentado: "Contacto acrescentado",
  campanha_criada: "Campanha criada", campanha_alterada: "Campanha alterada", campanha_do_comercial: "Campanha do comercial", consulta_outra_carteira: "Consultou empresa de outra carteira",
  nao_contactar_marcado: "Marcou «Não contactar»", nao_contactar_retirado: "Retirou «Não contactar»",
  login: "Entrou", login_falhado: "Entrada falhada", conta_bloqueada: "Conta bloqueada", codigo_2fa_errado: "Código 2FA errado",
  "2fa_ativada": "Ativou a 2FA", palavra_passe_alterada: "Alterou a palavra-passe", utilizador_criado: "Criou utilizador",
  utilizador_alterado: "Alterou utilizador", palavra_passe_reposta: "Repôs palavra-passe", "2fa_reposta": "Repôs 2FA",
  sessao_terminada: "Terminou sessão", configuracao_alterada: "Alterou configuração",
};

const GROUPS: [string, string][] = [["", "Tudo"], ["imports", "Importações"], ["wallet", "Carteiras"], ["contacts", "Contactos"], ["campaigns", "Campanhas"], ["access", "Entradas e segurança"], ["admin", "Utilizadores e configurações"]];

function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [imports, setImports] = useState<AuditEntry[]>([]);
  const [group, setGroup] = useState("");
  const [error, setError] = useState("");
  const load = () => {
    api.audit(group || undefined).then(setRows).catch((e) => setError(e.message));
    api.audit("imports", 6).then(setImports).catch(() => undefined);
  };
  useEffect(() => { load(); }, [group]);
  const isImport = (a: string) => a.startsWith("importacao");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Importações sempre em destaque, por mais registos que haja. */}
      <section style={{ ...card, padding: "14px 16px", borderColor: c.brand }}>
        <b style={{ fontSize: 14 }}>Últimas importações</b>
        {imports.length === 0 && <p style={{ margin: "6px 0 0", fontSize: 13, color: c.muted }}>Ainda não há importações.</p>}
        {imports.map((r) => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "130px 160px 200px 1fr", gap: 12, padding: "7px 0", borderBottom: `1px solid ${c.line}`, fontSize: 13 }}>
            <span style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.at)}</span><span>{r.userName}</span><b>{ACTIONS[r.action] ?? r.action}</b><span style={{ color: c.muted }}>{r.details ?? ""}</span>
          </div>
        ))}
      </section>
      <section style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${c.line}`, gap: 12, flexWrap: "wrap" }}>
          <b>Histórico de auditoria</b>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
            {GROUPS.map(([id, label]) => <button key={id} onClick={() => setGroup(id)} style={{ ...btn, height: 28, fontSize: 12, padding: "0 10px", background: group === id ? c.ink : c.card, color: group === id ? "#FFF" : c.ink, borderColor: group === id ? c.ink : c.line }}>{label}</button>)}
          </div>
          <button style={{ ...btn, height: 30, fontSize: 12 }} onClick={load}>Atualizar</button>
        </div>
        <ErrorText>{error}</ErrorText>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#FAFAFA", color: c.muted, textAlign: "left" }}>{["Quando", "Quem", "O quê", "Sobre", "Detalhe"].map((h) => <th key={h} style={{ padding: "10px 12px", fontWeight: 600 }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} style={{ borderTop: `1px solid ${c.line}`, background: isImport(r.action) ? c.brandSoft : undefined, fontWeight: isImport(r.action) ? 600 : 400 }}>
              <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{fmtDateTime(r.at)}</td>
              <td style={{ padding: "8px 12px" }}>{r.userName}</td>
              <td style={{ padding: "8px 12px" }}>{ACTIONS[r.action] ?? r.action}</td>
              <td style={{ padding: "8px 12px" }}>{r.targetName ?? "—"}</td>
              <td title={r.details ?? ""} style={{ padding: "8px 12px", color: c.muted, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.details ?? ""}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
