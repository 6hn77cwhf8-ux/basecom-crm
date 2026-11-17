import { useState, type CSSProperties, type ReactNode } from "react";

/** Cores do Design System BASECOM. */
/** Cores do Design System BASECOM, em variáveis do tema (claro ou escuro, escolhido por cada pessoa). */
export const c = {
  surface: "var(--bc-surface)", card: "var(--bc-card)", line: "var(--bc-line)", ink: "var(--bc-ink)", muted: "var(--bc-muted)", brand: "#FF5A00",
  brandSoft: "var(--bc-brand-soft)", danger: "var(--bc-danger)", dangerSoft: "var(--bc-danger-soft)", ok: "var(--bc-ok)", okSoft: "var(--bc-ok-soft)",
  warn: "var(--bc-warn)", warnSoft: "var(--bc-warn-soft)", sunken: "var(--bc-sunken)", onInk: "var(--bc-on-ink)", nav: "var(--bc-nav)",
};
export const font = "Manrope, -apple-system, 'Segoe UI', sans-serif";
export const input: CSSProperties = { fontFamily: "inherit", fontSize: 14, height: 38, padding: "0 12px", border: `1px solid ${c.line}`, borderRadius: 10, background: c.card, color: c.ink, boxSizing: "border-box" };
export const btn: CSSProperties = { fontFamily: "inherit", fontSize: 14, fontWeight: 600, height: 38, padding: "0 16px", borderRadius: 10, border: `1px solid ${c.line}`, background: c.card, color: c.ink, cursor: "pointer" };
export const btnDark: CSSProperties = { ...btn, background: c.ink, color: c.onInk, borderColor: c.ink };
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

/** 21225 → «21.225» (separador de milhares com ponto, como pedido para o CRM). */
export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."));
/** 1234.5 → «1.234,50 €». */
export const fmtEur = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "—";
  const [i, d] = Number(v).toFixed(2).split(".");
  return `${fmtInt(Number(i))},${d} €`;
};

export function Kpi({ label, value, hint, active, onClick }: { label: string; value: ReactNode; hint?: ReactNode; active?: boolean; onClick?: () => void }) {
  const style: CSSProperties = { ...card, flex: 1, minWidth: 0, padding: "14px 16px", textAlign: "left", display: "flex", flexDirection: "column", gap: 4, borderColor: active ? c.ink : c.line, fontFamily: "inherit", color: c.ink };
  const body = (
    <>
      <span style={{ fontSize: 12, color: c.muted, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 26, lineHeight: "30px", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {hint && <span style={{ fontSize: 12, color: c.muted }}>{hint}</span>}
    </>
  );
  return onClick ? <button type="button" onClick={onClick} aria-pressed={active} style={{ ...style, cursor: "pointer" }}>{body}</button> : <div style={style}>{body}</div>;
}

export const th: CSSProperties = { padding: "10px 12px", fontWeight: 600, borderBottom: `1px solid ${c.line}`, textAlign: "left", whiteSpace: "nowrap" };
export const td: CSSProperties = { padding: "10px 12px", borderBottom: `1px solid ${c.line}`, verticalAlign: "middle" };

/** Botão «Copiar» (NIF, OP…): copia o texto e mostra «Copiado ✓» por momentos. */
export function CopyButton({ text, label = "Copiar", small = true }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" title={`Copiar ${text}`} aria-label={`Copiar ${text}`}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => undefined); }}
      style={{ ...btn, height: small ? 26 : 32, padding: "0 9px", fontSize: 12, transition: "background .2s, color .2s", ...(done ? { background: c.ok, color: c.onInk, borderColor: c.ok } : {}) }}>
      {done ? "Copiado ✓" : label}
    </button>
  );
}

/** Foto da pessoa (ou as iniciais, se ainda não tiver foto), com aro opcional. */
export function Avatar({ name, photo, size = 32, ring }: { name: string; photo?: string | null; size?: number; ring?: string }) {
  const initials = name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const style: CSSProperties = { width: size, height: size, flex: `0 0 ${size}px`, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: Math.round(size * 0.38), fontWeight: 800, background: c.brandSoft, color: c.ink, overflow: "hidden", boxShadow: ring ? `0 0 0 2px ${c.card}, 0 0 0 4px ${ring}` : undefined };
  return photo ? <img src={photo} alt={name} title={name} style={{ ...style, objectFit: "cover" }} /> : <span role="img" aria-label={name} title={name} style={style}>{initials}</span>;
}

/** Reduz uma imagem escolhida pela pessoa para 192×192 (JPEG), para guardar como foto. */
export function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = 192, cv = document.createElement("canvas");
      cv.width = s; cv.height = s;
      const ctx = cv.getContext("2d")!;
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, s, s);
      resolve(cv.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Não foi possível ler a imagem (use JPG, PNG ou WEBP)."));
    // Lida como data: (a política de segurança da página não deixa abrir blob:).
    const fr = new FileReader();
    fr.onload = () => { img.src = String(fr.result); };
    fr.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    fr.readAsDataURL(file);
  });
}

/** Ligar pelo computador (opção pessoal, guardada neste computador): sem telemóvel BASECOM, abre «tel:» (no Mac, FaceTime/iPhone). */
export const dialPref = {
  get(): boolean { try { return localStorage.getItem("bc_dial_computer") === "1"; } catch { return false; } },
  set(v: boolean) { try { localStorage.setItem("bc_dial_computer", v ? "1" : "0"); } catch { /* sem armazenamento */ } },
};
export function dialOnComputer(phone: string | null | undefined) {
  if (phone && dialPref.get()) window.open(`tel:+351${phone.replace(/\D/g, "")}`);
}

/**
 * Cores sóbrias (desenho 18 «Cor com calma», aprovado a 17 nov): tons suaves da mesma família, em pequenos apontamentos
 * (ícones do menu, caixas do painel do dia, ponto nos estados, linha nas etapas). Os botões ficam neutros.
 */
export const tone = {
  indigo: "#6B72A8", blue: "#5B7DB1", slate: "#7A8494", sage: "#5E9C76", teal: "#4F9493",
  sand: "#B8924A", rose: "#B07282", plum: "#8A72AE", orange: "#D9773F",
} as const;
/** Fundo suave de um tom (funciona no claro e no escuro). */
export const tint = (hex: string, a = 0.12) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
export const Dot = ({ color, size = 7 }: { color: string; size?: number }) => <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 999, background: color, flex: `0 0 ${size}px`, display: "inline-block" }} />;
