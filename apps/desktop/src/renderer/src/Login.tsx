import { useState, type FormEvent } from "react";
import { api, type LoginStep, type User } from "./api";

const c = { surface: "#F5F5F7", card: "#FFFFFF", line: "#E5E5EA", ink: "#0B0B0B", muted: "#6E6E73", brand: "#FF5A00", danger: "#A1000F" };
const input: React.CSSProperties = { fontFamily: "inherit", fontSize: 15, height: 44, padding: "0 14px", border: `1px solid ${c.line}`, borderRadius: 10, width: "100%", boxSizing: "border-box" };
const button: React.CSSProperties = { fontFamily: "inherit", fontSize: 15, fontWeight: 700, height: 46, borderRadius: 12, border: 0, background: c.ink, color: "#FFFFFF", cursor: "pointer", width: "100%" };

export function Login({ onDone }: { onDone: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<LoginStep | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const submitPassword = (e: FormEvent) => { e.preventDefault(); run(async () => setStep(await api.login(email, password))); };
  const submitCode = (e: FormEvent) => { e.preventDefault(); if (step) run(async () => onDone(await api.confirmCode(step.challengeToken, code))); };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: c.surface, fontFamily: "Manrope, -apple-system, 'Segoe UI', sans-serif", color: c.ink }}>
      <section style={{ width: 400, background: c.card, border: `1px solid ${c.line}`, borderRadius: 14, padding: "32px 36px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ width: 40, height: 4, background: c.brand, borderRadius: 2 }} />
        <h1 style={{ margin: 0, fontSize: 26 }}>BASECOM CRM</h1>

        {!step && (
          <form onSubmit={submitPassword} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>Email
              <input style={input} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>Palavra-passe
              <input style={input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button style={button} disabled={busy}>{busy ? "A entrar…" : "Entrar"}</button>
          </form>
        )}

        {step && (
          <form onSubmit={submitCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {step.step === "enroll" ? (
              <>
                <p style={{ margin: 0, fontSize: 14, lineHeight: "20px" }}>
                  <b>Primeira entrada: ative a verificação em dois passos.</b><br />
                  No Microsoft Authenticator, carregue em <b>+</b> › <b>Outra conta</b> e leia este código QR.
                </p>
                <img src={step.qrDataUrl} alt="Código QR para o Microsoft Authenticator" width={200} height={200} style={{ alignSelf: "center" }} />
                <p style={{ margin: 0, fontSize: 12, color: c.muted }}>Sem câmara? Introduza a chave à mão: <code>{step.secret}</code></p>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 14 }}>Introduza o código de 6 dígitos do Microsoft Authenticator.</p>
            )}
            <input style={{ ...input, fontSize: 22, letterSpacing: "0.3em", textAlign: "center" }} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} required autoFocus aria-label="Código de 6 dígitos" />
            <button style={button} disabled={busy || code.length !== 6}>{busy ? "A verificar…" : "Confirmar"}</button>
            <button type="button" onClick={() => { setStep(null); setCode(""); setError(""); }} style={{ ...button, background: "transparent", color: c.muted, fontWeight: 600 }}>Voltar</button>
          </form>
        )}

        {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: c.danger, fontWeight: 600 }}>{error}</p>}
      </section>
    </main>
  );
}
