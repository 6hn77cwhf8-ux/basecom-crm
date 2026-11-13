import { useState, type FormEvent } from "react";
import { api, type LoginStep, type User } from "./api";
import { AuthLayout } from "./AuthLayout";
import { btnDark, c, ErrorText, Field, input } from "./ui";

const big = { ...input, height: 44, fontSize: 15, width: "100%" };
const primary = { ...btnDark, height: 46, fontSize: 15, width: "100%" };

export function Login({ onDone }: { onDone: (u: User) => void }) {
  const [email, setEmail] = useState(() => { try { return localStorage.getItem("bc_email") ?? ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<LoginStep | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const submitPassword = (e: FormEvent) => { e.preventDefault(); try { localStorage.setItem("bc_email", email.trim()); } catch { /* sem armazenamento */ } run(async () => setStep(await api.login(email, password))); };
  const submitCode = (e: FormEvent) => { e.preventDefault(); if (step) run(async () => onDone(await api.confirmCode(step.challengeToken, code))); };
  const back = () => { setStep(null); setCode(""); setError(""); };

  if (!step) {
    return (
      <AuthLayout title="Entrar" subtitle="Use o seu email e a sua palavra-passe.">
        <form onSubmit={submitPassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Email"><input style={big} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} /></Field>
          <Field label="Palavra-passe"><input style={big} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={!!email} /></Field>
          <button style={{ ...primary, marginTop: 6 }} disabled={busy}>{busy ? "A entrar…" : "Entrar"}</button>
          <ErrorText>{error}</ErrorText>
        </form>
      </AuthLayout>
    );
  }

  const enroll = step.step === "enroll";
  return (
    <AuthLayout
      title={enroll ? "Ativar verificação em dois passos" : "Código de verificação"}
      subtitle={enroll
        ? <>No Microsoft Authenticator, carregue em <b>+</b> › <b>Outra conta</b> e leia este código QR.</>
        : "Introduza o código de 6 dígitos do Microsoft Authenticator."}
    >
      <form onSubmit={submitCode} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {enroll && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 16, border: `1px solid ${c.line}`, borderRadius: 14 }}>
            <img src={step.qrDataUrl} alt="Código QR para o Microsoft Authenticator" width={188} height={188} />
            <p style={{ margin: 0, fontSize: 12, lineHeight: "16px", color: c.muted, textAlign: "center" }}>
              Sem câmara? Introduza a chave à mão:<br /><code style={{ fontSize: 12, color: c.ink, wordBreak: "break-all" }}>{step.secret}</code>
            </p>
          </div>
        )}
        <input style={{ ...big, height: 52, fontSize: 24, letterSpacing: "0.35em", textAlign: "center", fontVariantNumeric: "tabular-nums" }}
          inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} required autoFocus aria-label="Código de 6 dígitos" />
        <button style={primary} disabled={busy || code.length !== 6}>{busy ? "A verificar…" : "Confirmar"}</button>
        <button type="button" onClick={back} style={{ border: 0, background: "transparent", color: c.muted, cursor: "pointer", fontSize: 14, fontWeight: 600, height: 36 }}>Voltar</button>
        <ErrorText>{error}</ErrorText>
      </form>
    </AuthLayout>
  );
}
