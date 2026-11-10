import { useEffect, useState } from "react";
import { api, type AuditEntry, type Settings as S } from "../api";
import { btn, btnDark, c, card, ErrorText, fmtDateTime, input, PageHeader } from "../ui";

type Section = "timeLimits" | "auth" | "audit";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "timeLimits", label: "Limites de tempo" },
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
          <span style={{ fontSize: 12, color: c.muted, padding: "8px 12px" }}>As restantes secções (campanhas, scripts, catálogos…) chegam com as fases seguintes.</span>
        </nav>
        {section === "audit" ? <Audit /> : <Limits key={section} kind={section} />}
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
  login: "Entrou", login_falhado: "Entrada falhada", conta_bloqueada: "Conta bloqueada", codigo_2fa_errado: "Código 2FA errado",
  "2fa_ativada": "Ativou a 2FA", palavra_passe_alterada: "Alterou a palavra-passe", utilizador_criado: "Criou utilizador",
  utilizador_alterado: "Alterou utilizador", palavra_passe_reposta: "Repôs palavra-passe", "2fa_reposta": "Repôs 2FA",
  sessao_terminada: "Terminou sessão", configuracao_alterada: "Alterou configuração",
};

function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const load = () => api.audit().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  return (
    <section style={{ ...card, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${c.line}` }}>
        <b>Histórico de auditoria</b><button style={{ ...btn, height: 30, fontSize: 12 }} onClick={load}>Atualizar</button>
      </div>
      <ErrorText>{error}</ErrorText>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ background: "#FAFAFA", color: c.muted, textAlign: "left" }}>{["Quando", "Quem", "O quê", "Sobre", "Detalhe"].map((h) => <th key={h} style={{ padding: "10px 12px", fontWeight: 600 }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} style={{ borderTop: `1px solid ${c.line}` }}>
            <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{fmtDateTime(r.at)}</td>
            <td style={{ padding: "8px 12px" }}>{r.userName}</td>
            <td style={{ padding: "8px 12px" }}>{ACTIONS[r.action] ?? r.action}</td>
            <td style={{ padding: "8px 12px" }}>{r.targetName ?? "—"}</td>
            <td style={{ padding: "8px 12px", color: c.muted, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.details ?? ""}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}
