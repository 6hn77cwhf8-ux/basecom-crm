import { useState } from "react";
import { api, type NewCompany } from "../api";
import { btn, btnDark, c, ErrorText, Field, input } from "../ui";
import { DatePicker } from "./DatePicker";
import { Modal } from "./Wallet";

const KINDS: [NewCompany["kind"], string, string][] = [
  ["NN", "NN", "Ainda não é cliente NOS"],
  ["NC", "Cliente NC", "Já é cliente NOS (carteira NC)"],
  ["FC", "Cliente FC", "Já é cliente NOS (carteira FC)"],
];
const OPERATORS = ["NOS", "MEO", "Vodafone", "DIGI", "NOWO", "Outra"];

/**
 * Nova empresa (20 nov): qualquer perfil, NN / NC / FC, todos os campos. Fica sem carteira e sem campanha.
 * Se o NIF já existir no CRM, abre a ficha da empresa que já lá está.
 */
export function NewCompanyDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string, existed: boolean) => void }) {
  const [f, setF] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<NewCompany["kind"]>("NN");
  const [operator, setOperator] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const v = (k: string) => f[k] ?? "";
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const t = (k: string) => v(k).trim() || null;
  const num = (k: string) => { const s = v(k).trim().replace(/\./g, "").replace(",", "."); return s ? Number(s) : null; };
  const nifOk = /^\d{9}$/.test(v("nif").replace(/\s/g, ""));

  const save = () => {
    const l2b = num("l2b"); const months = num("months");
    if (l2b != null && !Number.isFinite(l2b)) return setErr("Mensalidade L2B inválida.");
    if (months != null && !Number.isInteger(months)) return setErr("Meses de fidelização inválidos.");
    setBusy(true); setErr("");
    api.createCompany({
      nif: v("nif").replace(/\s/g, ""), name: v("name").trim(), kind,
      phones: [v("phone1"), v("phone2")].map((p) => p.trim()).filter(Boolean), email: t("email"), decisor: t("decisor"),
      address: t("address"), postalCode: t("postalCode"), locality: t("locality"), municipality: t("municipality"), district: t("district"),
      sector: t("sector"), operator: kind === "NN" ? operator || null : "NOS", l2bMonthly: l2b, loyaltyMonths: months, loyaltyEnd: t("loyaltyEnd"), note: t("note"),
    }).then((r) => onOpen(r.id, r.existed)).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  };

  const row = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } as const;
  const full = { ...input, width: "100%" };
  const pill = (on: boolean) => ({ ...btn, height: 32, fontSize: 13, padding: "0 12px", ...(on ? { background: c.ink, color: c.onInk, borderColor: c.ink } : {}) });
  return (
    <Modal title="Nova empresa" onClose={onClose} width={640}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "70vh", overflowY: "auto", paddingRight: 4 }}>
        <Field label="Tipo">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {KINDS.map(([k, label, hint]) => <button key={k} type="button" title={hint} style={pill(kind === k)} onClick={() => setKind(k)}>{label}</button>)}
          </div>
        </Field>
        <div style={row}>
          <Field label="NIF (obrigatório)"><input style={full} inputMode="numeric" maxLength={11} value={v("nif")} onChange={set("nif")} placeholder="9 algarismos" /></Field>
          <Field label="Nome da empresa (obrigatório)"><input style={full} value={v("name")} onChange={set("name")} /></Field>
        </div>
        <div style={row}>
          <Field label="Decisor"><input style={full} value={v("decisor")} onChange={set("decisor")} placeholder="Ex.: Sr. João Silva" /></Field>
          <Field label="Email"><input style={full} type="email" value={v("email")} onChange={set("email")} /></Field>
        </div>
        <div style={row}>
          <Field label="Telefone principal"><input style={full} inputMode="tel" value={v("phone1")} onChange={set("phone1")} /></Field>
          <Field label="Outro telefone"><input style={full} inputMode="tel" value={v("phone2")} onChange={set("phone2")} /></Field>
        </div>
        <Field label="Morada"><input style={full} value={v("address")} onChange={set("address")} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12 }}>
          <Field label="Código postal"><input style={full} value={v("postalCode")} onChange={set("postalCode")} placeholder="1234-567" /></Field>
          <Field label="Localidade"><input style={full} value={v("locality")} onChange={set("locality")} /></Field>
        </div>
        <div style={row}>
          <Field label="Concelho"><input style={full} value={v("municipality")} onChange={set("municipality")} /></Field>
          <Field label="Distrito"><input style={full} value={v("district")} onChange={set("district")} /></Field>
        </div>
        <Field label="Setor de atividade"><input style={full} value={v("sector")} onChange={set("sector")} /></Field>
        {kind === "NN" && <Field label="Operadora atual">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {OPERATORS.map((o) => <button key={o} type="button" style={pill(operator === o)} onClick={() => setOperator(operator === o ? "" : o)}>{o}</button>)}
          </div>
        </Field>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
          <Field label="Mensalidade L2B (€)"><input style={full} inputMode="decimal" value={v("l2b")} onChange={set("l2b")} placeholder="Ex.: 89,90" /></Field>
          <Field label="Fidelização (meses)"><input style={full} inputMode="numeric" value={v("months")} onChange={set("months")} placeholder="Ex.: 24" /></Field>
          <Field label="Fim de fidelização"><DatePicker value={v("loyaltyEnd")} onChange={(d) => setF({ ...f, loyaltyEnd: d })} width={170} ariaLabel="Fim de fidelização" /></Field>
        </div>
        <Field label="Nota"><textarea style={{ ...full, height: 64, padding: 10, resize: "vertical" }} value={v("note")} onChange={set("note")} /></Field>
        <p style={{ margin: 0, fontSize: 12, color: c.muted }}>Fica sem carteira e sem campanha. Se o NIF já existir no CRM, abre a ficha que já existe.</p>
        <ErrorText>{err}</ErrorText>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" style={btn} onClick={onClose}>Voltar</button>
        <button type="button" style={btnDark} disabled={busy || !nifOk || v("name").trim().length < 2} onClick={save}>{busy ? "A criar…" : "Criar e abrir a ficha"}</button>
      </div>
    </Modal>
  );
}
