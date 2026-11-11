/**
 * Regras puras para empresas e importação (documento «Importação e reconciliação»).
 * Sem acesso a base de dados: o servidor e a aplicação usam as mesmas funções.
 */

/** NIF português: 9 algarismos e dígito de controlo (módulo 11). */
export function isValidNif(raw: string | number | null | undefined): boolean {
  const nif = cleanNif(raw);
  if (!/^\d{9}$/.test(nif)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(nif[i]) * (9 - i);
  const r = sum % 11;
  const check = r < 2 ? 0 : 11 - r;
  return check === Number(nif[8]);
}

/** Tira espaços, pontos e o prefixo «PT» que às vezes vem colado ao NIF. */
export function cleanNif(raw: string | number | null | undefined): string {
  return String(raw ?? "").toUpperCase().replace(/^PT/, "").replace(/[\s.\-]/g, "");
}

export type PhoneType = "mobile" | "landline" | "other";
export type Phone = { e164: string; national: string; type: PhoneType };

/**
 * Telefone em +351 com indicação de fixo ou móvel. Aceita «912345678», «+351 912 345 678»,
 * «00351912345678». Devolve null quando não é um número português de 9 algarismos.
 */
export function normalizePhone(raw: string | number | null | undefined): Phone | null {
  let d = String(raw ?? "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("351")) d = d.slice(3);
  if (!/^\d{9}$/.test(d)) return null;
  const type: PhoneType = d.startsWith("9") ? "mobile" : d.startsWith("2") || d.startsWith("3") ? "landline" : "other";
  return { e164: `+351${d}`, national: d, type };
}

/** «912 345 678» para mostrar no ecrã. */
export function formatPhone(national: string): string {
  return national.length === 9 ? `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}` : national;
}

const LEGAL_WORDS = new Set(["lda", "limitada", "unipessoal", "sa", "sociedade", "soc", "s", "a", "lda.", "sgps", "crl", "e"]);

/** Nome limpo só para comparar duplicados: «Lda», «Lda.», «Limitada» e acentos não contam. */
export function normalizeCompanyName(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !LEGAL_WORDS.has(w))
    .join(" ");
}

export type OperatorConfig = { list: string[]; aliases: Record<string, string> };

/** Lista aprovada (Catálogos operacionais) e sinónimos do documento de importação; o Administrador pode alterar. */
export const DEFAULT_OPERATORS: OperatorConfig = {
  list: ["MEO", "NOS", "Vodafone", "DIGI", "NOWO", "WOO", "Amigo", "UZO", "WTF", "Moche", "Yorn"],
  aliases: { VOD: "Vodafone", VDF: "Vodafone", DIGGI: "DIGI" },
};

/**
 * Só aceita operadoras da lista configurada. Tudo o resto (notas, nomes de pessoas, datas)
 * devolve-se como nota para o histórico da empresa.
 */
export function normalizeOperator(raw: string | null | undefined, cfg: OperatorConfig = DEFAULT_OPERATORS): { operator: string | null; note: string | null } {
  const v = String(raw ?? "").trim();
  if (!v) return { operator: null, note: null };
  const key = v.toUpperCase();
  const alias = Object.entries(cfg.aliases).find(([a]) => a.toUpperCase() === key)?.[1];
  const hit = alias ?? cfg.list.find((o) => o.toUpperCase() === key);
  return hit ? { operator: hit, note: null } : { operator: null, note: v };
}

const SALUTATIONS = ["Senhora", "Senhor", "Sra.", "Sra", "Sr.", "Sr", "Dra.", "Dr.", "Eng.ª", "Eng."];

/** «Sr. Paulo Rebelo» → tratamento «Sr.» e nome «Paulo Rebelo». */
export function splitSalutation(raw: string | null | undefined): { salutation: string | null; name: string } {
  const v = String(raw ?? "").trim().replace(/\s+/g, " ");
  for (const s of SALUTATIONS) {
    if (v.toLowerCase().startsWith(s.toLowerCase() + " ")) return { salutation: s, name: v.slice(s.length + 1).trim() };
  }
  return { salutation: null, name: v };
}

/** «LIGAR 06/05 || SEM CONTATO» → notas separadas; datas sem ano ficam como texto. */
export function splitHistory(raw: string | null | undefined): string[] {
  return String(raw ?? "").split("||").map((s) => s.trim()).filter(Boolean);
}

/** Data do Excel (texto AAAA-MM-DD, data ou número de série) → «AAAA-MM-DD», ou null. */
export function toIsoDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + raw * 86400000).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Valor em euros vindo do Excel: 105, «105,50», «1.234,56 €». */
export function toEuros(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  let s = String(raw).replace(/[€\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
