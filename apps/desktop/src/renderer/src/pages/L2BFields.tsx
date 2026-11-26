import { c, Field, input } from "../ui";

/** Informação do cliente (25 nov): mensalidade L2B, fidelização 24/36 e meses que faltam. */
export type L2BDraft = { monthly: string; contract: 24 | 36 | null; left: string };
export const emptyL2B = (contract: 24 | 36 | null = null): L2BDraft => ({ monthly: "", contract, left: "" });

const num = (v: string) => { const s = v.trim().replace(/\./g, "").replace(",", "."); return s ? Number(s) : NaN; };

export function l2bReady(d: L2BDraft, need: { contract?: boolean; left?: boolean }) {
  const m = num(d.monthly);
  if (!(m >= 0)) return false;
  if (need.contract && !d.contract) return false;
  if (need.left) { const l = Number(d.left); if (d.left === "" || !Number.isInteger(l) || l < 0 || l > 60) return false; }
  return true;
}

export function l2bValue(d: L2BDraft) {
  return { monthly: Math.round(num(d.monthly) * 100) / 100, contractMonths: d.contract ?? undefined, monthsLeft: d.left === "" ? undefined : Number(d.left) };
}

const addMonths = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toLocaleDateString("pt-PT"); };

/**
 * Campos da informação do cliente. `left`: pede os meses que faltam (recusa); sem `left` e com contrato, o fim é
 * hoje + 24/36 (venda). `recent`: mostra quando o CRM volta a ligar (8 meses depois do início do contrato).
 */
export function L2BFields({ value, onChange, need, title, recent, contactAfterMonths = 8 }: {
  value: L2BDraft; onChange: (d: L2BDraft) => void; need: { contract?: boolean; left?: boolean }; title: string; recent?: boolean; contactAfterMonths?: number;
}) {
  const pill = (on: boolean) => ({ height: 34, padding: "0 14px", borderRadius: 999, border: `1px solid ${on ? c.ink : c.line}`, background: on ? c.ink : c.card, color: on ? c.onInk : c.ink, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" });
  const left = Number(value.left);
  const hasLeft = value.left !== "" && Number.isInteger(left);
  const contactIn = recent && value.contract && hasLeft ? Math.max(0, left - (value.contract - contactAfterMonths)) : null;
  return (
    <div role="group" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, border: `1px solid ${c.line}`, borderRadius: 12 }}>
      <b style={{ fontSize: 13 }}>{title}</b>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Field label="Mensalidade do cliente (L2B) · obrigatório"><input style={{ ...input, width: 150 }} inputMode="decimal" placeholder="0,00 €/mês" aria-label="Mensalidade do cliente" value={value.monthly} onChange={(e) => onChange({ ...value, monthly: e.target.value.replace(/[^0-9,.]/g, "") })} /></Field>
        {need.contract && <Field label="Fidelização · obrigatório">
          <div role="radiogroup" aria-label="Fidelização" style={{ display: "flex", gap: 6 }}>
            {([24, 36] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={value.contract === m} style={pill(value.contract === m)} onClick={() => onChange({ ...value, contract: m })}>{m} meses</button>)}
          </div>
        </Field>}
        {need.left && <Field label="Meses que faltam · obrigatório"><input style={{ ...input, width: 110 }} inputMode="numeric" aria-label="Meses que faltam" value={value.left} onChange={(e) => onChange({ ...value, left: e.target.value.replace(/\D/g, "").slice(0, 2) })} /></Field>}
      </div>
      {need.left && hasLeft && <span style={{ fontSize: 12, color: c.muted }}>Fim da fidelização: {addMonths(left)} (desconta sozinho na ficha).</span>}
      {!need.left && value.contract && <span style={{ fontSize: 12, color: c.muted }}>Fim da fidelização: {addMonths(value.contract)} (a contar de hoje).</span>}
      {contactIn != null && <span style={{ fontSize: 13, padding: "8px 12px", background: c.brandSoft, borderRadius: 10 }}>O CRM volta a ligar {contactIn === 0 ? "já (entra nas campanhas)" : `daqui a ${contactIn} ${contactIn === 1 ? "mês" : "meses"} (${addMonths(contactIn)})`} — {contactAfterMonths} meses depois do início do contrato.</span>}
    </div>
  );
}
