import { useState, type FormEvent } from "react";
import { api } from "./api";
import { AuthLayout } from "./AuthLayout";
import { btnDark, c, ErrorText, Field, input } from "./ui";

const big = { ...input, height: 44, fontSize: 15, width: "100%" };

/** Obrigatório na primeira entrada (palavra-passe provisória) ou depois de uma reposição. */
export function ChangePassword({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setError("As duas palavras-passe novas não são iguais.");
    setBusy(true); setError("");
    try { await api.changePassword(current, next); onDone(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <AuthLayout title="Escolha a sua palavra-passe" subtitle="Está a usar uma palavra-passe provisória. Escolha uma nova com pelo menos 10 caracteres.">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Palavra-passe provisória"><input style={big} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus /></Field>
        <Field label="Nova palavra-passe"><input style={big} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} /></Field>
        <Field label="Repetir a nova palavra-passe"><input style={big} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required /></Field>
        <button style={{ ...btnDark, height: 46, fontSize: 15, marginTop: 6 }} disabled={busy}>{busy ? "A guardar…" : "Guardar e continuar"}</button>
        <button type="button" onClick={onLogout} style={{ border: 0, background: "transparent", color: c.muted, cursor: "pointer", fontSize: 14, fontWeight: 600, height: 36 }}>Sair</button>
        <ErrorText>{error}</ErrorText>
      </form>
    </AuthLayout>
  );
}
