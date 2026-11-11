import type { ReactNode } from "react";
import { c } from "./ui";
import logoNegativo from "./assets/logo-negativo.webp";
import simbolo from "./assets/simbolo.webp";

/**
 * Ecrãs de entrada (login, 2FA, nova palavra-passe): painel institucional em grafite com o
 * logótipo negativo e a marca de água do símbolo (permitida só no login, pelo Design System),
 * formulário à direita sobre branco.
 */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(420px, 46%) 1fr", background: c.card, color: c.ink }}>
      <aside style={{ position: "relative", overflow: "hidden", background: "#222222", color: "#FFFFFF", padding: "48px 56px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <img src={logoNegativo} alt="BASECOM" style={{ width: 220, height: "auto" }} />
        <img src={simbolo} alt="" aria-hidden="true" style={{ position: "absolute", right: -120, bottom: -60, width: 560, opacity: 0.08, pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14 }}>
          <span style={{ width: 40, height: 4, borderRadius: 2, background: c.brand }} />
          <p style={{ margin: 0, fontSize: 32, lineHeight: "38px", fontWeight: 800 }}>
            CRM<span style={{ color: c.brand }}>.</span>
          </p>
          <p style={{ margin: 0, fontSize: 14, lineHeight: "20px", color: "#C7C7CC", maxWidth: 320 }}>Acesso reservado à equipa BASECOM.</p>
          <p style={{ margin: 0, fontSize: 12, color: "#8E8E93" }}>Versão {__APP_VERSION__}</p>
        </div>
      </aside>
      <section style={{ display: "grid", placeItems: "center", padding: 48 }}>
        <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 20 }}>
          <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: "34px", fontWeight: 800 }}>{title}</h1>
            {subtitle && <p style={{ margin: 0, fontSize: 14, lineHeight: "20px", color: c.muted }}>{subtitle}</p>}
          </header>
          {children}
        </div>
      </section>
    </main>
  );
}
