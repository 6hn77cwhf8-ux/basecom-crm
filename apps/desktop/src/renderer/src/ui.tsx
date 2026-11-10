import type { CSSProperties, ReactNode } from "react";

/** Cores do Design System BASECOM. */
export const c = { surface: "#F5F5F7", card: "#FFFFFF", line: "#E5E5EA", ink: "#0B0B0B", muted: "#6E6E73", brand: "#FF5A00", brandSoft: "#FFF1E8", danger: "#A1000F", dangerSoft: "#FFE5E7", ok: "#1E6F33", okSoft: "#E8F5EC", warn: "#8A3D00", warnSoft: "#FFF4E5" };
export const font = "Manrope, -apple-system, 'Segoe UI', sans-serif";
export const input: CSSProperties = { fontFamily: "inherit", fontSize: 14, height: 38, padding: "0 12px", border: `1px solid ${c.line}`, borderRadius: 10, background: c.card, color: c.ink, boxSizing: "border-box" };
export const btn: CSSProperties = { fontFamily: "inherit", fontSize: 14, fontWeight: 600, height: 38, padding: "0 16px", borderRadius: 10, border: `1px solid ${c.line}`, background: c.card, color: c.ink, cursor: "pointer" };
export const btnDark: CSSProperties = { ...btn, background: c.ink, color: "#FFFFFF", borderColor: c.ink };
export const card: CSSProperties = { background: c.card, border: `1px solid ${c.line}`, borderRadius: 14 };

export function Chip({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad" | "brand"; children: ReactNode }) {
  const m = { neutral: [c.surface, c.ink], ok: [c.okSoft, c.ok], warn: [c.warnSoft, c.warn], bad: [c.dangerSoft, c.danger], brand: [c.brandSoft, c.ink] }[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: m[0], color: m[1], whiteSpace: "nowrap" }}>{children}</span>;
}

export function PageHeader({ eyebrow, title, actions }: { eyebrow: string; title: string; actions?: ReactNode }) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: c.muted }}>{eyebrow}</span>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: "34px", fontWeight: 800 }}>{title}</h1>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>
    </header>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>{label}{children}</label>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p role="alert" style={{ margin: 0, fontSize: 13, color: c.danger, fontWeight: 600 }}>{children}</p> : null;
}

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-PT") : "—");
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
