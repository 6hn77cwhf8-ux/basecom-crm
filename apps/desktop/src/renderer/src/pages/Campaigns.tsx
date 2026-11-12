import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DEFAULT_SCRIPTS } from "@basecom/shared";
import { api, type Campaign, type CampaignFilters, type FilterOptions } from "../api";
import { btn, btnDark, c, card, Chip, ErrorText, Field, fmtInt, input } from "../ui";
import { Modal } from "./Wallet";

const MODE = { new: "Novos clientes · Power Dialer", current: "Clientes atuais · Preview Dialer" } as const;
const STATUS = { active: ["A decorrer", "ok"], paused: ["Em pausa", "warn"], ended: ["Terminada", "neutral"] } as const;
export const FIELDS_HELP = "{comercial} · {empresa} · {decisor} (o confirmado, com o tratamento: «a Senhora Dona Ana…») · {decisor1} · {decisor2} · {campanha} (nome desta campanha) · {nbo} (campanha NBO da empresa)";

/** Configurações → Campanhas (só Administrador nesta fase). */
export function Campaigns() {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => api.campaigns().then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const act = (fn: () => Promise<unknown>, msg?: string) => fn().then(() => { if (msg) setNotice(msg); load(); }).catch((e) => setError(e.message));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 16 }}>Campanhas</b>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: c.muted }}>Ficam de fora: «Não contactar», empresas encerradas, em prazo de reutilização, sem telefone válido, de outras carteiras ou já noutra campanha.</p>
        </div>
        <button style={btnDark} onClick={() => setEditing("new")}>Nova campanha</button>
      </div>
      {notice && <p role="status" style={{ margin: 0, padding: "10px 14px", borderRadius: 10, background: "#E8F5EC", color: "#1E6F33", fontSize: 14, fontWeight: 600 }}>{notice}</p>}
      <ErrorText>{error}</ErrorText>
      {list && list.length > 0 && <Assignments campaigns={list} onError={setError} />}
      {list?.length === 0 && <p style={{ ...card, margin: 0, padding: 24, textAlign: "center", color: c.muted }}>Ainda não há campanhas.</p>}
      {list?.map((k) => (
        <article key={k.id} style={{ ...card, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, opacity: k.status === "ended" ? 0.6 : 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <b style={{ fontSize: 15 }}>{k.name}</b>
            <Chip tone={STATUS[k.status][1]}>{STATUS[k.status][0]}</Chip>
            <span style={{ fontSize: 12, color: c.muted }}>{MODE[k.mode]}</span>
            <span style={{ flex: 1 }} />
            {k.status !== "ended" && <>
              <button style={small} onClick={() => setEditing(k)}>Editar</button>
              <button style={small} onClick={() => act(() => api.refreshCampaign(k.id).then((r) => setNotice(`${fmtInt(r.added)} empresas acrescentadas a «${k.name}».`)))}>Atualizar lista</button>
              <button style={small} onClick={() => act(() => api.updateCampaign(k.id, { status: k.status === "active" ? "paused" : "active" }))}>{k.status === "active" ? "Pausar" : "Retomar"}</button>
              <button style={{ ...small, color: "#A1000F" }} onClick={() => confirm(`Terminar «${k.name}»? As empresas por ligar ficam livres para outras campanhas.`) && act(() => api.updateCampaign(k.id, { status: "ended" }))}>Terminar</button>
            </>}
          </div>
          <Progress k={k} />
          <span style={{ fontSize: 12, color: c.muted }}>Comerciais: {k.members.map((m) => m.name).join(", ") || "—"}</span>
        </article>
      ))}
      {editing && <CampaignForm campaign={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(msg) => { setEditing(null); setNotice(msg); load(); }} />}
    </section>
  );
}

const small = { ...btn, height: 30, fontSize: 12 };
const ta = { ...input, height: 88, padding: 10, resize: "vertical" as const, lineHeight: "20px" };

/**
 * Campanha de cada comercial no Power Dialer (Novos clientes): decide o Administrador; o comercial não escolhe.
 * Escolher aqui também o junta aos comerciais da campanha.
 */
function Assignments({ campaigns, onError }: { campaigns: Campaign[]; onError: (m: string) => void }) {
  const [rows, setRows] = useState<{ id: string; name: string; role: string; campaignId: string | null }[]>([]);
  const [saved, setSaved] = useState("");
  const load = () => api.dialerAssignments().then(setRows).catch((e) => onError(e.message));
  useEffect(() => { load(); }, []);
  const options = campaigns.filter((k) => k.mode === "new" && k.status !== "ended");
  const current = (r: (typeof rows)[number]) => r.campaignId ?? (() => { const mine = options.filter((k) => k.status === "active" && k.members.some((m) => m.id === r.id)); return mine.length === 1 ? mine[0]!.id : ""; })();
  return (
    <div style={{ ...card, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
      <b style={{ fontSize: 15 }}>Campanha de cada comercial · Novos clientes</b>
      <span style={{ fontSize: 13, color: c.muted }}>O comercial entra diretamente nesta campanha no Power Dialer, sem escolher.</span>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14 }}>
          <span style={{ width: 220 }}>{r.name}</span>
          <select style={{ ...input, height: 34, width: 320 }} value={current(r)} onChange={(e) => api.setDialerCampaign(r.id, e.target.value || null).then(() => { setSaved(r.id); setTimeout(() => setSaved(""), 1500); load(); }).catch((err) => onError(err.message))}>
            <option value="">Sem campanha</option>
            {options.map((k) => <option key={k.id} value={k.id}>{k.name}{k.status === "paused" ? " (em pausa)" : ""}</option>)}
          </select>
          {saved === r.id && <span style={{ fontSize: 13, color: c.ok, fontWeight: 600 }}>Guardado ✓</span>}
        </div>
      ))}
    </div>
  );
}

function Progress({ k }: { k: Campaign }) {
  const pct = (n: number) => (k.total ? `${(n / k.total) * 100}%` : "0%");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: c.line }}>
        <span style={{ width: pct(k.done), background: c.ink }} /><span style={{ width: pct(k.exhausted), background: "#B25000" }} />
      </div>
      <span style={{ fontSize: 13 }}>
        <b>{fmtInt(k.total)}</b> empresas · <b>{fmtInt(k.done)}</b> concluídas · <b>{fmtInt(k.exhausted)}</b> esgotadas · <b>{fmtInt(k.pending)}</b> por trabalhar (<b>{fmtInt(k.ready)}</b> prontas agora)
      </span>
    </div>
  );
}

function CampaignForm({ campaign, onClose, onSaved }: { campaign: Campaign | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const editing = !!campaign;
  const [name, setName] = useState(campaign?.name ?? "");
  const [mode, setMode] = useState<"new" | "current">(campaign?.mode ?? "new");
  const [script, setScript] = useState(campaign?.script || DEFAULT_SCRIPTS.opening);
  const [pitchNew, setPitchNew] = useState(campaign?.scriptPitchNew || DEFAULT_SCRIPTS.pitchNew);
  const [pitchCurrent, setPitchCurrent] = useState(campaign?.scriptPitchCurrent || DEFAULT_SCRIPTS.pitchCurrent);
  // Texto igual ao de omissão fica vazio na base de dados: assim acompanha futuras melhorias do texto por omissão.
  const own = (v: string, d: string) => (v.trim() === d ? null : v);
  const [members, setMembers] = useState<string[]>(campaign?.members.map((m) => m.id) ?? []);
  const [f, setF] = useState<CampaignFilters>(campaign?.filters ?? { accountType: "prospect" });
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [opts, setOpts] = useState<FilterOptions | null>(null);
  const [count, setCount] = useState<{ total: number; clients: number; in_wallet: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.users().then((u) => setUsers(u.filter((x) => x.active && x.role !== "admin"))).catch((e) => setError(e.message));
    api.filterOptions().then(setOpts).catch(() => undefined);
  }, []);
  const key = useMemo(() => JSON.stringify([f, members]), [f, members]);
  useEffect(() => {
    if (editing) return;
    const t = setTimeout(() => api.previewCampaign(f, members).then(setCount).catch(() => setCount(null)), 300);
    return () => clearTimeout(t);
  }, [key, editing]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (campaign) { await api.updateCampaign(campaign.id, { name, script, scriptPitchNew: own(pitchNew, DEFAULT_SCRIPTS.pitchNew), scriptPitchCurrent: own(pitchCurrent, DEFAULT_SCRIPTS.pitchCurrent), memberIds: members }); onSaved(`Campanha «${name}» guardada.`); }
      else { const r = await api.createCampaign({ name, mode, script, scriptPitchNew: own(pitchNew, DEFAULT_SCRIPTS.pitchNew), scriptPitchCurrent: own(pitchCurrent, DEFAULT_SCRIPTS.pitchCurrent), filters: f, memberIds: members }); onSaved(`Campanha «${name}» criada com ${fmtInt(r.added)} empresas.`); }
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const set = <K extends keyof CampaignFilters>(k: K, v: CampaignFilters[K]) => setF((o) => ({ ...o, [k]: v }));
  // Concelhos: só os dos distritos escolhidos (todos, quando não há distrito escolhido).
  const munis = f.districts?.length && opts?.municipalitiesByDistrict ? [...new Set(f.districts.flatMap((d) => opts.municipalitiesByDistrict![d] ?? []))].sort((a, b) => a.localeCompare(b, "pt")) : opts?.municipalities;

  return (
    <Modal title={editing ? `Editar «${campaign.name}»` : "Nova campanha"} onClose={onClose} width={720}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Nome"><input style={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={3} placeholder="Ex.: Empresas recém-criadas — novembro" /></Field>
          <Field label="Tipo"><select style={input} value={mode} disabled={editing} onChange={(e) => setMode(e.target.value as "new" | "current")}>
            <option value="new">{MODE.new}</option><option value="current">{MODE.current}</option></select></Field>
        </div>
        <Field label="Comerciais da campanha">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {users.map((u) => <Toggle key={u.id} on={members.includes(u.id)} label={u.name} onClick={() => setMembers((m) => (m.includes(u.id) ? m.filter((x) => x !== u.id) : [...m, u.id]))} />)}
          </div>
        </Field>
        {!editing && (
          <fieldset style={{ border: `1px solid ${c.line}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <legend style={{ fontSize: 13, fontWeight: 700, padding: "0 6px" }}>Que empresas entram</legend>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <Field label="Tipo de conta"><select style={input} value={f.accountType ?? ""} onChange={(e) => set("accountType", (e.target.value || undefined) as CampaignFilters["accountType"])}>
                <option value="">Todos</option><option value="prospect">Prospetos (NN)</option><option value="client">Clientes NOS</option></select></Field>
              <Field label="Fim de fidelização desde"><input style={input} type="date" value={f.loyaltyEndFrom ?? ""} onChange={(e) => set("loyaltyEndFrom", e.target.value || undefined)} /></Field>
              <Field label="até"><input style={input} type="date" value={f.loyaltyEndTo ?? ""} onChange={(e) => set("loyaltyEndTo", e.target.value || undefined)} /></Field>
            </div>
            <Multi label="Distrito" all={opts?.districts} value={f.districts} onChange={(v) => setF((o) => {
              // Ao mudar os distritos, os concelhos que já não pertencem a nenhum deles saem da escolha.
              const allowed = v?.length && opts?.municipalitiesByDistrict ? new Set(v.flatMap((d) => opts.municipalitiesByDistrict![d] ?? [])) : null;
              const m = allowed ? o.municipalities?.filter((x) => allowed.has(x)) : o.municipalities;
              return { ...o, districts: v, municipalities: m?.length ? m : undefined };
            })} />
            <Multi label={f.districts?.length ? `Concelho · de ${f.districts.join(", ")}` : "Concelho"} all={munis} value={f.municipalities} onChange={(v) => set("municipalities", v)} search={!f.districts?.length} />
            {!!opts?.nboCampaigns?.length && <Multi label="Campanha NBO da NOS" all={opts.nboCampaigns.map((x) => x.v)} labels={Object.fromEntries(opts.nboCampaigns.map((x) => [x.v, `${x.v.replace(/\s*\|\s*/g, " · ")} (${fmtInt(x.n)})`]))} value={f.nboCampaigns} onChange={(v) => set("nboCampaigns", v)} />}
            <Multi label="Setor" all={opts?.sectors} value={f.sectors} onChange={(v) => set("sectors", v)} />
            <Multi label="Operadora atual" all={opts?.operators} value={f.operators} onChange={(v) => set("operators", v)} />
            <Multi label="Estado no portal NOS" all={opts?.portalStatuses} value={f.portalStatus} onChange={(v) => set("portalStatus", v)} />
            <Multi label="Tecnologia" all={opts?.technologies} value={f.technologies} onChange={(v) => set("technologies", v)} />
            <Multi label="Produto" all={opts?.products} value={f.products} onChange={(v) => set("products", v)} />
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={!!f.onlyWithoutOwner} onChange={(e) => set("onlyWithoutOwner", e.target.checked || undefined)} /> Só empresas sem carteira</label>
            <div role="status" style={{ padding: "10px 12px", borderRadius: 10, background: c.brandSoft, fontSize: 14 }}>
              {count ? <><b>{fmtInt(count.total)}</b> empresas vão entrar · {fmtInt(count.clients)} clientes NOS · {fmtInt(count.in_wallet)} da carteira dos comerciais escolhidos (só para o respetivo responsável)</> : "A contar…"}
            </div>
          </fieldset>
        )}
        <Field label="Script · 1. Abertura (pede o responsável; o comercial confirma ou muda o decisor)">
          <textarea style={ta} value={script} onChange={(e) => setScript(e.target.value)} />
        </Field>
        <Field label="Script · 2. Apresentação a empresas sem serviços NOS (NN)">
          <textarea style={ta} value={pitchNew} onChange={(e) => setPitchNew(e.target.value)} />
        </Field>
        <Field label="Script · 2. Apresentação a clientes NOS">
          <textarea style={ta} value={pitchCurrent} onChange={(e) => setPitchCurrent(e.target.value)} />
        </Field>
        <span style={{ fontSize: 12, color: c.muted, marginTop: -6 }}>Campos automáticos: {FIELDS_HELP}</span>
        <ErrorText>{error}</ErrorText>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={btn} onClick={onClose}>Cancelar</button>
          <button style={btnDark} disabled={busy || name.trim().length < 3 || !members.length || (!editing && !count?.total)}>{busy ? "A guardar…" : editing ? "Guardar" : "Criar campanha"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={on} style={{ ...btn, height: 30, fontSize: 12, background: on ? c.ink : c.card, color: on ? "#FFF" : c.ink, borderColor: on ? c.ink : c.line }}>{label}</button>;
}

/** Escolha múltipla; vazio = todos. */
function Multi({ label, all, value, onChange, search, labels }: { label: string; all?: string[]; value?: string[]; onChange: (v: string[] | undefined) => void; search?: boolean; labels?: Record<string, string> }) {
  const [q, setQ] = useState("");
  if (!all?.length) return null;
  const v = value ?? [];
  const shown = all.filter((x) => !q || x.toLowerCase().includes(q.toLowerCase())).slice(0, search ? 40 : 60);
  const flip = (x: string) => { const n = v.includes(x) ? v.filter((y) => y !== x) : [...v, x]; onChange(n.length ? n : undefined); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label} <span style={{ color: c.muted, fontWeight: 400 }}>{v.length ? `· ${v.length} escolhido(s)` : "· todos"}</span></span>
      {search && <input style={{ ...input, height: 30 }} placeholder="Procurar…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {[...v.filter((x) => !shown.includes(x)), ...shown].map((x) => <Toggle key={x} on={v.includes(x)} label={labels?.[x] ?? x} onClick={() => flip(x)} />)}
      </div>
    </div>
  );
}
