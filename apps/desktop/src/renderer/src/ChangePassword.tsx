import { useState, type FormEvent } from "react";
import { api } from "./api";
import { btnDark, c, card, ErrorText, Field, font, input } from "./ui";

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
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: c.surface, fontFamily: font, color: c.ink }}>
      <form onSubmit={submit} style={{ ...card, width: 420, padding: "32px 36px", display: "flex", flexDirection: "column", gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Escolha a sua palavra-passe</h1>
        <p style={{ margin: 0, fontSize: 14, color: c.muted }}>Está a usar uma palavra-passe provisória. Escolha uma nova com pelo menos 10 caracteres.</p>
        <Field label="Palavra-passe provisória"><input style={input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus /></Field>
        <Field label="Nova palavra-passe"><input style={input} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} /></Field>
        <Field label="Repetir a nova palavra-passe"><input style={input} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required /></Field>
        <button style={{ ...btnDark, height: 44 }} disabled={busy}>{busy ? "A guardar…" : "Guardar e continuar"}</button>
        <button type="button" onClick={onLogout} style={{ border: 0, background: "transparent", color: c.muted, cursor: "pointer", fontFamily: "inherit" }}>Sair</button>
        <ErrorText>{error}</ErrorText>
      </form>
    </main>
  );
}
