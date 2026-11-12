import { useEffect, useState } from "react";
import { api, type Outcome, type Reason } from "../api";
import { btn, btnDark, c, card, ErrorText, input } from "../ui";

type Cat = {
  outcomes: Outcome[]; reasons: Reason[]; taskTypes: string[];
  attempts: { noAnswerRetryMinutes: number; busyRetryMinutes: number; maxAttemptsPerDay: number; maxAttemptsTotal: number; maxVoicemailsPerNumber: number };
  opportunities: { warnDays: number; lateDays: number; lostReopenDays: number };
};

const GROUP: Record<string, string> = { refuse: "Recusa", callback: "Callback", noanswer: "Não atende", proposal: "Proposta", sale: "Venda", other: "Outro" };
const EFFECT: Record<Reason["effect"], string> = {
  cooldown: "Volta às campanhas após X dias", loyalty_end: "Outro operador: fidelizado (data do cliente)", new_contract: "Outro operador: renovou (data do cliente)",
  followup_task: "Tarefa de seguimento após X dias", company_closed: "Empresa encerrada (sai de tudo)", other: "Outro (descrição obrigatória)",
};
const ATTEMPTS: [keyof Cat["attempts"], string, string][] = [
  ["noAnswerRetryMinutes", "Não atendeu: nova tentativa após", "min"], ["busyRetryMinutes", "Ocupado: nova tentativa após", "min"],
  ["maxAttemptsPerDay", "Máximo de tentativas por dia", "vezes"], ["maxAttemptsTotal", "Máximo de tentativas na campanha", "vezes"],
  ["maxVoicemailsPerNumber", "Voicemails até o número ficar esgotado", "vezes"],
];
const OPPS: [keyof Cat["opportunities"], string, string][] = [
  ["warnDays", "Alerta preventivo ao fim de", "dias"], ["lateDays", "Atrasada ao fim de", "dias"], ["lostReopenDays", "Perdida: volta às campanhas após", "dias"],
];
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "motivo";

/**
 * Configurações → Catálogos (catálogo, secção 10): o Administrador muda nomes, ativa e desativa resultados e motivos,
 * cria motivos, altera prazos e tipos de tarefa, sem programação. Cada gravação fica na auditoria.
 * As consequências automáticas de cada resultado são estruturais e não se mudam aqui.
 */
export function CatalogSettings() {
  const [cat, setCat] = useState<Cat | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState("");
  useEffect(() => { api.catalogs().then((r) => setCat(r.catalogs as unknown as Cat)).catch((e) => setError(e.message)); }, []);
  if (!cat) return <section style={{ ...card, padding: 24 }}>{error ? <ErrorText>{error}</ErrorText> : "A carregar…"}</section>;

  const set = (patch: Partial<Cat>) => { setCat({ ...cat, ...patch }); setSaved(false); };
  async function save() {
    setBusy(true); setError("");
    try { await api.saveSetting("catalogs" as never, cat as never); setSaved(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const num = (v: number, on: (n: number) => void) => <input type="number" min={0} style={{ ...input, width: 90, height: 34 }} value={v} onChange={(e) => on(Number(e.target.value))} />;
  const box = { ...card, padding: "16px 18px", display: "flex", flexDirection: "column" as const, gap: 10 };
  const h = { margin: 0, fontSize: 15 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={box}>
        <h2 style={h}>Resultados de chamada</h2>
        <span style={{ fontSize: 13, color: c.muted }}>Pode mudar o nome e desativar. O que cada resultado faz (tentativas, tarefas, oportunidades…) é fixo.</span>
        {cat.outcomes.map((o, i) => (
          <div key={o.id} style={{ display: "grid", gridTemplateColumns: "110px 1fr auto", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: c.muted }}>{GROUP[o.group]}</span>
            <input style={{ ...input, height: 34 }} value={o.label} onChange={(e) => set({ outcomes: cat.outcomes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
            <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={o.active} onChange={(e) => set({ outcomes: cat.outcomes.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)) })} /> Ativo</label>
          </div>
        ))}
      </section>

      <section style={box}>
        <h2 style={h}>Motivos de recusa e de perda</h2>
        <span style={{ fontSize: 13, color: c.muted }}>O mesmo catálogo serve «Sem interesse» e «Oportunidade perdida».</span>
        {cat.reasons.map((r, i) => {
          const upd = (p: Partial<Reason>) => set({ reasons: cat.reasons.map((x, j) => (j === i ? { ...x, ...p } : x)) });
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 280px 120px auto", gap: 10, alignItems: "center" }}>
              <input style={{ ...input, height: 34 }} value={r.label} onChange={(e) => upd({ label: e.target.value })} />
              <select style={{ ...input, height: 34 }} value={r.effect} onChange={(e) => upd({ effect: e.target.value as Reason["effect"] })}>
                {Object.entries(EFFECT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <span>{(r.effect === "cooldown" || r.effect === "followup_task") ? <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>{num(r.days ?? 0, (n) => upd({ days: n }))} dias</span> : null}</span>
              <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={r.active} onChange={(e) => upd({ active: e.target.checked })} /> Ativo</label>
            </div>
          );
        })}
        <button style={{ ...btn, height: 32, fontSize: 13, alignSelf: "flex-start" }} onClick={() => {
          let id = slug("novo motivo"); let k = 1; while (cat.reasons.some((r) => r.id === id)) id = `${slug("novo motivo")}_${k++}`;
          set({ reasons: [...cat.reasons, { id, label: "Novo motivo", effect: "cooldown", days: 90, active: true }] });
        }}>+ Acrescentar motivo</button>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <section style={box}>
          <h2 style={h}>Tentativas</h2>
          {ATTEMPTS.map(([k, l, u]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, gap: 10 }}><span>{l}</span><span style={{ display: "flex", gap: 6, alignItems: "center" }}>{num(cat.attempts[k], (n) => set({ attempts: { ...cat.attempts, [k]: n } }))}<span style={{ color: c.muted, width: 40 }}>{u}</span></span></div>)}
        </section>
        <section style={box}>
          <h2 style={h}>Oportunidades</h2>
          {OPPS.map(([k, l, u]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, gap: 10 }}><span>{l}</span><span style={{ display: "flex", gap: 6, alignItems: "center" }}>{num(cat.opportunities[k], (n) => set({ opportunities: { ...cat.opportunities, [k]: n } }))}<span style={{ color: c.muted, width: 40 }}>{u}</span></span></div>)}
        </section>
      </div>

      <section style={box}>
        <h2 style={h}>Tipos de tarefa</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {cat.taskTypes.map((t) => <span key={t} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: `1px solid ${c.line}`, borderRadius: 10, padding: "4px 6px 4px 10px", fontSize: 13 }}>{t}
            <button aria-label={`Retirar ${t}`} style={{ border: 0, background: "none", cursor: "pointer", color: c.muted }} disabled={cat.taskTypes.length === 1} onClick={() => set({ taskTypes: cat.taskTypes.filter((x) => x !== t) })}>×</button></span>)}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...input, height: 34, width: 260 }} placeholder="Novo tipo de tarefa" value={newType} onChange={(e) => setNewType(e.target.value)} />
          <button style={{ ...btn, height: 34, fontSize: 13 }} disabled={!newType.trim() || cat.taskTypes.includes(newType.trim())} onClick={() => { set({ taskTypes: [...cat.taskTypes, newType.trim()] }); setNewType(""); }}>Acrescentar</button>
        </div>
      </section>

      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end", position: "sticky", bottom: 0, padding: "10px 0", background: c.surface }}>
        <ErrorText>{error}</ErrorText>
        {saved && <span role="status" style={{ color: c.ok, fontSize: 13, fontWeight: 600 }}>Guardado e registado na auditoria.</span>}
        <button style={btnDark} disabled={busy} onClick={save}>{busy ? "A guardar…" : "Guardar catálogos"}</button>
      </div>
    </div>
  );
}
