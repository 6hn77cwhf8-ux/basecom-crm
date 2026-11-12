/**
 * Scripts das campanhas em dois passos (Teste 1):
 * 1. Abertura — pede o responsável e confirma o decisor («Sim» ou «Mudar de decisor»);
 * 2. Apresentação — muda conforme a empresa seja cliente NOS ou não (NN).
 * O Administrador edita os três textos em cada campanha; estes são os textos por omissão.
 */
export const DEFAULT_SCRIPTS = {
  opening: "Olá, o meu nome é {comercial} e estava a entrar em contacto porque gostaria de falar com a pessoa responsável da empresa {empresa}. Seria possível? Falo com {decisor}?",
  pitchNew: "Muito bem. Eu estava a ligar por parte da NOS Empresas. Estávamos a entrar em contacto para dar a conhecer as soluções da NOS Empresas para os serviços da sua empresa. Teria 30 segundos para falarmos?",
  pitchCurrent: "Muito bem. Eu estava a ligar por parte da NOS Empresas, no seguimento da campanha {campanha}. Estávamos a entrar em contacto para dar a conhecer a campanha {campanha}. Seria possível?",
};

export const SCRIPT_FIELDS = ["comercial", "empresa", "decisor", "decisor1", "decisor2", "campanha", "nbo"] as const;
export type ScriptVars = Partial<Record<(typeof SCRIPT_FIELDS)[number], string>>;

const FIELD_LABEL: Record<string, string> = { comercial: "comercial", empresa: "empresa", decisor: "nome do responsável", decisor1: "decisor 1", decisor2: "decisor 2", campanha: "campanha", nbo: "campanha NBO" };

/** Substitui os campos automáticos; um campo sem valor aparece entre parênteses retos para o comercial completar. */
export function renderScript(template: string, v: ScriptVars): string {
  return template.replace(/\{(comercial|empresa|decisor|decisor1|decisor2|campanha|nbo)\}/g, (_, k: string) => (v as Record<string, string | undefined>)[k] || `[${FIELD_LABEL[k]}]`);
}

/** Tratamento falado: «Srª» → «a Senhora Dona Ana…», «Sr.» → «o Senhor Rui…». */
const SPOKEN: Record<string, string> = {
  "srª": "a Senhora Dona", "sra": "a Senhora Dona", "sra.": "a Senhora Dona", "d.": "a Senhora Dona", "dona": "a Senhora Dona",
  "sr": "o Senhor", "sr.": "o Senhor",
  "dr": "o Senhor Doutor", "dr.": "o Senhor Doutor", "drª": "a Senhora Doutora", "dra": "a Senhora Doutora", "dra.": "a Senhora Doutora",
  "eng": "o Senhor Engenheiro", "eng.": "o Senhor Engenheiro", "engª": "a Senhora Engenheira", "enga": "a Senhora Engenheira",
};
export function spokenName(salutation: string | null | undefined, name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "";
  const s = SPOKEN[(salutation ?? "").trim().toLowerCase()];
  return s ? `${s} ${n}` : n;
}

/** Campanha NBO sem as ofertas: «SOMA | Adicionar fixo — …» → «SOMA · Adicionar fixo». */
export function nboHead(nbo: string | null | undefined): string {
  if (!nbo) return "";
  const head = nbo.includes(" — ") ? nbo.slice(0, nbo.indexOf(" — ")) : nbo;
  return head.split("|").map((x) => x.trim()).filter(Boolean).join(" · ");
}
