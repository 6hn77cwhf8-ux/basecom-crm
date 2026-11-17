/**
 * Tema (17 nov 2026): Claro, Escuro (azul-noite) ou Automático (segue o Windows ou o Mac). Escolhido por cada pessoa
 * e guardado no servidor; uma cópia local evita que o ecrã pisque ao abrir a aplicação.
 */
export type ThemePref = "light" | "dark" | "auto";
let media: MediaQueryList | null = null;
let current: ThemePref = "light";
const paint = () => {
  const dark = current === "dark" || (current === "auto" && !!media?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
};
export function applyTheme(pref: ThemePref) {
  current = pref;
  if (!media && typeof window !== "undefined" && window.matchMedia) {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", paint);
  }
  try { localStorage.setItem("bc_theme", pref); } catch { /* sem armazenamento */ }
  paint();
}
export function initialTheme() {
  try { applyTheme((localStorage.getItem("bc_theme") as ThemePref) || "light"); } catch { applyTheme("light"); }
}
