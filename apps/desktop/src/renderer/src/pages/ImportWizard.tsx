import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, type Batch, type ImportRow, type PreviewSummary, type SheetAction, type Upload } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, Field, fmtDateTime, fmtInt, input, Kpi, PageHeader, td, th } from "../ui";

const RESULT: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "brand" }> = {
  new: { label: "Nova", tone: "ok" }, update: { label: "Atualizar", tone: "neutral" }, duplicate_review: { label: "Duplicado a rever", tone: "warn" },
  nif_to_verify: { label: "NIF a verificar", tone: "warn" }, blocked: { label: "Bloqueada (RGPD)", tone: "bad" },
  review: { label: "Lista de revisão", tone: "brand" }, rejected: { label: "Rejeitada", tone: "bad" },
};
const ACTION: Record<SheetAction, string> = { import: "Importar", review: "Lista de revisão", skip: "Não importar" };
const STEPS = ["Ficheiro", "Análise", "Mapeamento", "Pré-visualização", "Confirmar"];
const STATUS: Record<string, string> = { uploaded: "Carregado", preview: "Em pré-visualização", committed: "Gravado", reverted: "Anulado", discarded: "Cancelado" };

/** Importação da base (só Administrador). Nada é gravado sem pré-visualização e código 2FA. */
export function ImportWizard({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [up, setUp] = useState<Upload | null>(null);
  const [sheets, setSheets] = useState<Record<string, SheetAction>>({});
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [trial, setTrial] = useState(true);
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [done, setDone] = useState<{ number: number; created: number; updated: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = () => api.imports().then(setBatches).catch(() => undefined);
  useEffect(() => { loadBatches(); }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }

  const upload = (file: File) => run("A ler o ficheiro…", async () => {
    const u = await api.uploadBase(file);
    setUp(u); setSheets(Object.fromEntries(u.sheets.map((s) => [s.name, s.action]))); setMapping(u.mapping); setStep(1); loadBatches();
  });
  const preview = (isTrial = trial) => run("A preparar a pré-visualização…", async () => {
    const r = await api.previewImport(up!.id, { sheets, mapping, limit: isTrial ? up!.trialSize : null });
    setSummary(r.summary); setStep(3);
  });
  const cancel = () => run("", async () => { if (up && !done) await api.discardImport(up.id); onBack(); });

  // Colunas das folhas que vão ser importadas (para o mapeamento).
  const columns = useMemo(() => {
    const set = new Set<string>();
    up?.sheets.filter((s) => sheets[s.name] === "import").forEach((s) => s.headers.forEach((h) => h && set.add(h)));
    return [...set];
  }, [up, sheets]);

  return (
    <>
      <PageHeader eyebrow="Empresas · importação" title="Importar ficheiro"
        actions={<>
          <Chip>Só Administrador</Chip>
          <button style={btn} onClick={done ? onBack : cancel}>{done ? "Voltar a Empresas" : "Cancelar"}</button>
        </>} />

      <ol style={{ display: "flex", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
        {STEPS.map((s, i) => (
          <li key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: i === step ? 700 : 500, color: i <= step ? c.ink : c.muted }}>
            <span style={{ width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, background: i < step || done ? c.ink : i === step ? c.brand : c.line, color: i <= step || done ? "#FFF" : c.muted }}>{i < step || done ? "✓" : i + 1}</span>
            {s}{i < STEPS.length - 1 && <span style={{ width: 24, height: 1, background: c.line }} />}
          </li>
        ))}
      </ol>
      {busy && <p role="status" style={{ margin: 0, fontSize: 14, color: c.muted }}>{busy}</p>}
      <ErrorText>{error}</ErrorText>

      {step === 0 && (
        <section style={{ ...card, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Escolha o ficheiro da base de empresas (Excel .xlsx)</h2>
          <p style={{ margin: 0, fontSize: 14, color: c.muted }}>O CRM lê o ficheiro e mostra um relatório. Nada é gravado até confirmar com o código do Microsoft Authenticator. O ficheiro original fica guardado com o lote.</p>
          <input type="file" accept=".xlsx" disabled={!!busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </section>
      )}

      {step === 1 && up && (
        <section style={{ ...card, overflow: "hidden" }}>
          <Head title={`Análise de «${up.fileName}»`} hint="Escolha o que fazer com cada folha. Valores propostos conforme as decisões de 10 nov." />
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#FAFAFA", color: c.muted }}>{["Folha", "Linhas", "NIF válidos", "NIF inválidos", "Sem NIF", "Telefones", "Sem telefone", "Colunas novas", "O que fazer"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{up.sheets.map((s) => (
              <tr key={s.name}>
                <td style={{ ...td, fontWeight: 600 }}>{s.name}</td><Num v={s.rows} /><Num v={s.validNif} /><Num v={s.invalidNif} warn /><Num v={s.emptyNif} warn />
                <Num v={s.phones} /><Num v={s.noContact} warn />
                <td style={{ ...td, color: c.muted, maxWidth: 220 }}>{s.unknownColumns.join(", ") || "—"}</td>
                <td style={td}><select style={{ ...input, height: 32 }} aria-label={`Ação para a folha ${s.name}`} value={sheets[s.name]} onChange={(e) => setSheets({ ...sheets, [s.name]: e.target.value as SheetAction })}>
                  {(Object.keys(ACTION) as SheetAction[]).map((a) => <option key={a} value={a}>{ACTION[a]}</option>)}
                </select></td>
              </tr>
            ))}</tbody>
          </table>
          <Foot><button style={btnDark} onClick={() => setStep(2)} disabled={!Object.values(sheets).includes("import")}>Continuar para o mapeamento</button></Foot>
        </section>
      )}

      {step === 2 && up && (
        <section style={{ ...card, overflow: "hidden" }}>
          <Head title="Mapeamento de colunas" hint="A que campo do CRM corresponde cada coluna. Fica guardado para as próximas importações." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 24px", padding: 16 }}>
            {columns.map((col) => (
              <label key={col} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${c.line}` }}>
                <span style={{ fontWeight: 600 }}>{col}{!mapping[col] && <Chip tone="warn">nova</Chip>}</span>
                <select style={{ ...input, height: 32, width: 260 }} value={mapping[col] ?? "ignore"} onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}>
                  {Object.entries(up.fields).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <Foot>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginRight: "auto" }}>
              <input type="checkbox" checked={trial} onChange={(e) => setTrial(e.target.checked)} /> Ensaio com {fmtInt(up.trialSize)} empresas (recomendado na primeira vez)
            </label>
            <button style={btn} onClick={() => setStep(1)}>Voltar</button>
            <button style={btnDark} disabled={!!busy || !Object.values(mapping).includes("nif")} onClick={() => preview()}>Ver pré-visualização</button>
          </Foot>
        </section>
      )}

      {step >= 3 && up && summary && <Preview id={up.id} summary={summary} trial={trial} done={done}
        onFull={() => { setTrial(false); preview(false); }} onBack={() => setStep(2)} onConfirm={() => setStep(4)} />}

      {step === 4 && up && !done && <Confirm summary={summary!} onCancel={() => setStep(3)} onCode={(code) => run("A gravar…", async () => { setDone(await api.commitImport(up.id, code)); loadBatches(); })} />}
      {done && (
        <section role="status" style={{ ...card, padding: 20, borderColor: c.ink }}>
          <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Lote {done.number} gravado</h2>
          <p style={{ margin: 0, fontSize: 14 }}>{fmtInt(done.created)} empresas novas e {fmtInt(done.updated)} atualizadas. Se algo não estiver certo, pode anular o lote inteiro na lista abaixo.</p>
        </section>
      )}

      <Batches batches={batches} onChange={loadBatches} />
    </>
  );
}

function Preview({ id, summary, trial, done, onFull, onBack, onConfirm }: { id: string; summary: PreviewSummary; trial: boolean; done: unknown; onFull: () => void; onBack: () => void; onConfirm: () => void }) {
  const [result, setResult] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<{ total: number; rows: ImportRow[] } | null>(null);
  useEffect(() => { api.importRows(id, { result: result || undefined, search: q || undefined, offset: page * 100, limit: 100 }).then(setRows).catch(() => undefined); }, [id, result, q, page, summary]);
  const k = (r: string) => summary.byResult[r] ?? 0;
  const pick = (r: string) => { setResult(result === r ? "" : r); setPage(0); };
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <Kpi label="Linhas" value={fmtInt(summary.total)} hint={trial ? "ensaio" : "ficheiro completo"} onClick={() => pick("")} active={!result} />
        {["new", "update", "duplicate_review", "nif_to_verify", "blocked", "review", "rejected"].filter((r) => k(r) > 0 || ["new", "update"].includes(r)).map((r) => (
          <Kpi key={r} label={RESULT[r]!.label} value={fmtInt(k(r))} onClick={() => pick(r)} active={result === r} />
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: c.muted }}>
        A gravar: {fmtInt(summary.clients)} clientes e {fmtInt(summary.prospects)} prospetos; {fmtInt(summary.withOwner)} entram em carteira de um comercial. Todas as NN entram sem carteira; com «Basecom» ou ex-comercial também ficam sem carteira. «Lista de revisão» e «Rejeitada» não entram. Nada foi gravado.
      </p>
      <section style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: `1px solid ${c.line}`, alignItems: "center" }}>
          <input style={{ ...input, height: 34, flex: 1 }} placeholder="Procurar por NIF ou nome" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <span style={{ fontSize: 13, color: c.muted }}>{rows ? `${fmtInt(rows.total)} linhas` : ""}</span>
        </div>
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#FAFAFA", color: c.muted, position: "sticky", top: 0 }}>{["Folha · linha", "NIF", "Empresa", "Tipo de conta", "Comercial responsável", "Resultado", "Detalhe"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows?.rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, color: c.muted, whiteSpace: "nowrap" }}>{r.sheet} · {r.rowNumber}</td>
                <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.nif ?? "—"}</td>
                <td style={{ ...td, fontWeight: 600 }}>{r.name ?? "—"}</td>
                <td style={td}>{r.accountType === "client" ? "Cliente" : r.accountType === "prospect" ? "NN" : "—"}</td>
                <td style={td}>{r.owner ?? "—"}</td>
                <td style={td}><Chip tone={RESULT[r.result]?.tone ?? "neutral"}>{RESULT[r.result]?.label ?? r.result}</Chip></td>
                <td style={{ ...td, color: c.muted }}>{r.detail}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {rows && rows.total > 100 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: 10 }}>
            <button style={{ ...btn, height: 30 }} disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <button style={{ ...btn, height: 30 }} disabled={(page + 1) * 100 >= rows.total} onClick={() => setPage(page + 1)}>Seguinte</button>
          </div>
        )}
      </section>
      {!done && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btn} onClick={onBack}>Voltar ao mapeamento</button>
          {trial && <button style={btn} onClick={onFull}>Pré-visualizar o ficheiro completo</button>}
          <button style={btnDark} onClick={onConfirm}>{trial ? "Gravar o ensaio" : "Gravar tudo"}</button>
        </div>
      )}
    </section>
  );
}

function Confirm({ summary, onCancel, onCode }: { summary: PreviewSummary; onCancel: () => void; onCode: (code: string) => void }) {
  const [code, setCode] = useState("");
  const toWrite = ["new", "update", "duplicate_review", "nif_to_verify"].reduce((a, r) => a + (summary.byResult[r] ?? 0), 0);
  const submit = (e: FormEvent) => { e.preventDefault(); onCode(code); };
  return (
    <form onSubmit={submit} style={{ ...card, padding: 20, display: "flex", gap: 16, alignItems: "flex-end" }}>
      <div style={{ flex: 1 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Confirmar a importação de {fmtInt(toWrite)} empresas</h2>
        <p style={{ margin: 0, fontSize: 14, color: c.muted }}>Introduza o código de 6 dígitos do Microsoft Authenticator. O lote fica numerado e pode ser anulado por inteiro.</p>
      </div>
      <Field label="Código"><input style={{ ...input, width: 140, fontSize: 18, letterSpacing: ".25em", textAlign: "center" }} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required /></Field>
      <button type="button" style={btn} onClick={onCancel}>Voltar</button>
      <button style={btnDark} disabled={code.length !== 6}>Confirmar importação</button>
    </form>
  );
}

function Batches({ batches, onChange }: { batches: Batch[]; onChange: () => void }) {
  const [reverting, setReverting] = useState<Batch | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const shown = batches.filter((b) => b.status !== "discarded" && b.status !== "uploaded");
  if (!shown.length) return null;
  const revert = async (e: FormEvent) => {
    e.preventDefault(); setError("");
    try { await api.revertImport(reverting!.id, code); setReverting(null); setCode(""); onChange(); } catch (err) { setError((err as Error).message); }
  };
  return (
    <section style={{ ...card, overflow: "hidden" }}>
      <Head title="Lotes de importação" hint="Cada lote pode ser anulado por inteiro (pede o código 2FA)." />
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ background: "#FAFAFA", color: c.muted }}>{["Lote", "Ficheiro", "Estado", "Resultado", "Quem", "Quando", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{shown.map((b) => (
          <tr key={b.id}>
            <td style={{ ...td, fontWeight: 700 }}>{b.number}</td><td style={td}>{b.fileName}</td>
            <td style={td}><Chip tone={b.status === "committed" ? "ok" : b.status === "reverted" ? "bad" : "neutral"}>{STATUS[b.status] ?? b.status}</Chip></td>
            <td style={td}>{b.summary.committed ? `${fmtInt(b.summary.committed.created)} novas · ${fmtInt(b.summary.committed.updated)} atualizadas` : b.summary.preview ? `${fmtInt(b.summary.preview.total)} linhas analisadas` : "—"}</td>
            <td style={td}>{b.createdBy ?? "—"}</td><td style={td}>{fmtDateTime(b.revertedAt ?? b.committedAt ?? b.createdAt)}</td>
            <td style={{ ...td, textAlign: "right" }}>{b.status === "committed" && <button style={{ ...btn, height: 30, color: "#A1000F" }} onClick={() => setReverting(b)}>Anular lote</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      {reverting && (
        <form onSubmit={revert} style={{ display: "flex", gap: 12, alignItems: "flex-end", padding: 16, borderTop: `1px solid ${c.line}`, background: "#FFF8F3" }}>
          <p style={{ margin: 0, flex: 1, fontSize: 14 }}><b>Anular o lote {reverting.number}?</b> As empresas criadas por este lote são apagadas e as atualizadas voltam aos valores anteriores.</p>
          <Field label="Código 2FA"><input style={{ ...input, width: 120, textAlign: "center" }} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus /></Field>
          <button type="button" style={btn} onClick={() => setReverting(null)}>Não anular</button>
          <button style={{ ...btnDark, background: "#A1000F", borderColor: "#A1000F" }} disabled={code.length !== 6}>Anular lote</button>
          <ErrorText>{error}</ErrorText>
        </form>
      )}
    </section>
  );
}

const Head = ({ title, hint }: { title: string; hint: string }) => (
  <div style={{ padding: "14px 16px", borderBottom: `1px solid ${c.line}` }}>
    <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2><p style={{ margin: "2px 0 0", fontSize: 13, color: c.muted }}>{hint}</p>
  </div>
);
const Foot = ({ children }: { children: ReactNode }) => <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", padding: 12, borderTop: `1px solid ${c.line}` }}>{children}</div>;
const Num = ({ v, warn }: { v: number; warn?: boolean }) => <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: warn && v > 0 ? "#8A3D00" : c.ink, fontWeight: warn && v > 0 ? 700 : 400 }}>{fmtInt(v)}</td>;
