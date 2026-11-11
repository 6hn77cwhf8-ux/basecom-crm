import { useEffect, useMemo, useState } from "react";
import { api, type CompanyFilters, type CompanyKpis, type CompanyRow, type FilterOptions, type User } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, fmtInt, input, Kpi, PageHeader, td, th } from "../ui";

const PAGE = 50;

/** Ecrã Empresas (maqueta «Empresas»): números, filtros, lista; o nome abre a ficha. */
export function Companies({ me, onOpen, onImport }: { me: User; onOpen: (id: string) => void; onImport: () => void }) {
  const [f, setF] = useState<CompanyFilters>({});
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: CompanyRow[] } | null>(null);
  const [kpis, setKpis] = useState<CompanyKpis | null>(null);
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [opts, setOpts] = useState<FilterOptions>({ municipalities: [], districts: [], sectors: [] });
  const [error, setError] = useState("");
  const isAdmin = me.role === "admin";

  useEffect(() => {
    api.companyKpis().then(setKpis).catch((e) => setError(e.message));
    api.filterOptions().then(setOpts).catch(() => undefined);
    if (me.role !== "sales") api.users().then((u) => setOwners(u.filter((x) => x.role === "sales" && x.active))).catch(() => undefined);
  }, [me.role]);

  // Pesquisa com uma pequena pausa enquanto se escreve.
  useEffect(() => { const t = setTimeout(() => { setF((o) => ({ ...o, q })); setPage(0); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    api.companies({ ...f, offset: page * PAGE, limit: PAGE }).then(setData).catch((e) => setError(e.message));
  }, [f, page]);

  const set = (k: keyof CompanyFilters, v: string) => { setF((o) => ({ ...o, [k]: v || undefined })); setPage(0); };
  const active = useMemo(() => Object.entries(f).filter(([, v]) => v).length, [f]);
  const clear = () => { setF({}); setQ(""); setPage(0); };
  const sel = { ...input, height: 36, minWidth: 0 };

  return (
    <>
      <PageHeader eyebrow="Base de dados" title="Empresas"
        actions={isAdmin && <button style={btnDark} onClick={onImport} title="Só o Administrador">Importar ficheiro</button>} />

      <div style={{ display: "flex", gap: 12 }}>
        <Kpi label="Total de empresas" value={fmtInt(kpis?.total)} hint={kpis ? `${fmtInt(kpis.clients)} clientes NOS` : undefined} onClick={clear} active={active === 0} />
        <Kpi label="Sem carteira" value={fmtInt(kpis?.noOwner)} hint="todas as NN entram assim" onClick={() => set("owner", "none")} active={f.owner === "none"} />
        <Kpi label="Em carteira" value={fmtInt(kpis?.withOwner)} hint={kpis ? `NC ${fmtInt(kpis.nc)} · FC ${fmtInt(kpis.fc)}` : undefined} onClick={() => set("owner", "any")} active={f.owner === "any"} />
        <Kpi label="Não contactar" value={fmtInt(kpis?.dnc)} hint="RGPD" onClick={() => set("status", "dnc")} active={f.status === "dnc"} />
        <Kpi label="A rever" value={fmtInt(kpis?.review)} hint="duplicados e NIF a verificar" onClick={() => set("status", "review")} active={f.status === "review"} />
      </div>

      <section style={{ ...card, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: `1px solid ${c.line}`, alignItems: "center", flexWrap: "wrap" }}>
          <input style={{ ...sel, flex: "1 1 260px" }} placeholder="Pesquisar por NIF, nome, telefone, decisor ou email" aria-label="Pesquisar empresas" value={q} onChange={(e) => setQ(e.target.value)} />
          <select style={sel} aria-label="Tipo de conta" value={f.accountType ?? ""} onChange={(e) => set("accountType", e.target.value)}>
            <option value="">Tipo de conta: todos</option><option value="client">Cliente NOS</option><option value="prospect">Prospeto (NN)</option>
          </select>
          <select style={sel} aria-label="Responsável" value={f.owner ?? ""} onChange={(e) => set("owner", e.target.value)}>
            <option value="">Responsável: todos</option><option value="none">Sem carteira</option><option value="any">Em carteira</option>
            {me.role === "sales" && <option value={me.id}>A minha carteira</option>}
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select style={sel} aria-label="Carteira" value={f.wallet ?? ""} onChange={(e) => set("wallet", e.target.value)}>
            <option value="">Carteira: todas</option><option value="NC">NC</option><option value="FC">FC</option>
          </select>
          <select style={sel} aria-label="Estado" value={f.status ?? ""} onChange={(e) => set("status", e.target.value)}>
            <option value="">Estado: todos</option><option value="dnc">Não contactar</option><option value="review">A rever</option><option value="nif">NIF a verificar</option>
          </select>
          <select style={{ ...sel, maxWidth: 170 }} aria-label="Distrito" value={f.district ?? ""} onChange={(e) => set("district", e.target.value)}>
            <option value="">Distrito: todos</option>{opts.districts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select style={{ ...sel, maxWidth: 170 }} aria-label="Concelho" value={f.municipality ?? ""} onChange={(e) => set("municipality", e.target.value)}>
            <option value="">Concelho: todos</option>{opts.municipalities.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select style={{ ...sel, maxWidth: 200 }} aria-label="Setor" value={f.sector ?? ""} onChange={(e) => set("sector", e.target.value)}>
            <option value="">Setor: todos</option>{opts.sectors.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span style={{ fontSize: 13, color: c.muted, marginLeft: "auto" }}>{data ? `${fmtInt(data.total)} empresas` : "A carregar…"}</span>
          {active > 0 && <button style={{ ...btn, height: 36 }} onClick={clear}>Limpar</button>}
        </div>
        <ErrorText>{error}</ErrorText>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#FAFAFA", color: c.muted }}>
              {["NIF", "Empresa", "Tipo", "Distrito", "Concelho", "Setor", "Responsável", "Carteira", "Estado"].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums", color: c.muted }}>{r.nif}</td>
                  <td style={td}><button onClick={() => onOpen(r.id)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: 13, textAlign: "left", color: c.ink }}>{r.name}</button></td>
                  <td style={td}>{r.accountType === "client" ? "Cliente" : "NN"}</td>
                  <td style={td}>{r.district ?? "—"}</td>
                  <td style={td}>{r.municipality ?? "—"}</td>
                  <td style={{ ...td, color: r.sector ? c.ink : c.muted }}>{r.sector ?? "—"}</td>
                  <td style={td}>{r.owner ?? <span style={{ color: c.muted }}>Sem carteira</span>}</td>
                  <td style={td}>{r.ownerId ? <Chip tone={r.walletKind === "FC" ? "warn" : "neutral"}>{r.walletKind}</Chip> : "—"}</td>
                  <td style={td}><StatusChips r={r} /></td>
                </tr>
              ))}
              {data && data.rows.length === 0 && (
                <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: c.muted, padding: 32 }}>
                  {kpis?.total === 0 ? "Ainda não há empresas. O Administrador importa a base em «Importar ficheiro»." : "Nenhum resultado com estes filtros."}
                  {active > 0 && <> <button style={{ ...btn, height: 30, marginLeft: 8 }} onClick={clear}>Limpar filtros</button></>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data && data.total > PAGE && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: 10, fontSize: 13 }}>
            <span style={{ color: c.muted }}>{fmtInt(page * PAGE + 1)}–{fmtInt(Math.min((page + 1) * PAGE, data.total))} de {fmtInt(data.total)}</span>
            <button style={{ ...btn, height: 30 }} disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <button style={{ ...btn, height: 30 }} disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Seguinte</button>
          </div>
        )}
      </section>
      <p style={{ margin: 0, fontSize: 12, color: c.muted }}>Carregue no nome para abrir a ficha. Qualquer comercial encontra qualquer empresa e vê o histórico; empresas de outra carteira nunca entram nas suas tarefas nem campanhas.</p>
    </>
  );
}

export function StatusChips({ r }: { r: Pick<CompanyRow, "doNotContact" | "needsReview" | "nifValid" | "accountType"> }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {r.doNotContact && <Chip tone="bad">Não contactar</Chip>}
      {!r.nifValid && <Chip tone="warn">NIF a verificar</Chip>}
      {r.needsReview && <Chip tone="warn">Duplicado a rever</Chip>}
      {!r.doNotContact && r.nifValid && !r.needsReview && <Chip tone={r.accountType === "client" ? "ok" : "neutral"}>{r.accountType === "client" ? "Cliente NOS" : "Prospeto"}</Chip>}
    </span>
  );
}
