/**
 * Mensagens rápidas (17 nov 2026): modelos de texto para WhatsApp, SMS e email, configuráveis pelo Administrador.
 * Campos automáticos: {decisor} {empresa} {op} {comercial}. Um campo sem valor desaparece da frase com o espaço à volta.
 */
export type MessageTemplate = { id: string; label: string; text: string; active: boolean };
export const MESSAGE_FIELDS = ["decisor", "empresa", "op", "comercial", "saudacao"] as const;
export type MessageVars = Partial<Record<(typeof MESSAGE_FIELDS)[number], string>>;

export const DEFAULT_MESSAGE_TEMPLATES: MessageTemplate[] = [
  // SMS automática no 1.º não atende (18 nov): só «NOS Empresas», com o pedido para devolver a chamada.
  { id: "tried_call", label: "Tentámos ligar (1.º não atende)", active: true,
    text: "{saudacao}, {decisor}. Tentámos ligar-lhe da NOS Empresas sobre as comunicações da {empresa}.\n\nLigue-nos para este número quando lhe der jeito — são 2 minutos.\n\n{comercial} · NOS Empresas" },
  { id: "no_answer", label: "Não conseguimos falar consigo", active: true,
    text: "Bom dia, {decisor}. Fala {comercial}, da BASECOM – parceiro NOS Empresas. Tentei contactá-lo(a) por telefone sobre os serviços da {empresa}. Quando lhe der jeito falarmos?" },
  { id: "proposal", label: "Proposta enviada", active: true,
    text: "Bom dia, {decisor}. Fala {comercial}, da BASECOM – parceiro NOS Empresas. Conforme combinámos, enviei a proposta para a {empresa} (referência {op}). Fico a aguardar a sua resposta e estou disponível para qualquer dúvida." },
  { id: "docs", label: "Pedir documentos", active: true,
    text: "Bom dia, {decisor}. Fala {comercial}, da BASECOM. Para avançarmos com o processo da {empresa} (referência {op}), preciso que me envie os documentos em falta. Obrigado(a)!" },
  { id: "docs_reminder", label: "Lembrete de documentos", active: true,
    text: "Bom dia, {decisor}. Fala {comercial}, da BASECOM. Só para lembrar os documentos em falta para concluirmos o processo da {empresa} (referência {op}). Qualquer dúvida, estou ao dispor." },
  { id: "meeting", label: "Confirmar reunião", active: true,
    text: "Bom dia, {decisor}. Fala {comercial}, da BASECOM. Confirmo a nossa conversa sobre os serviços da {empresa}. Até breve!" },
];

/** «Bom dia» até às 13h; depois «Boa tarde» (hora de Lisboa). */
export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", hourCycle: "h23" }).format(now));
  return h < 13 ? "Bom dia" : "Boa tarde";
}

export function renderMessage(text: string, v: MessageVars): string {
  const vars = { saudacao: greeting(), ...v } as Record<string, string | undefined>;
  return text
    .replace(/\s*\(referência \{op\}\)/g, v.op ? ` (referência ${v.op})` : "")
    .replace(/\{(decisor|empresa|op|comercial|saudacao)\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/ ,/g, ",")
    .replace(/ {2,}/g, " ").replace(/ ,/g, ",").replace(/ \./g, ".").replace(/,\./g, ".").trim();
}

/** Assinatura do comercial no WhatsApp e no email (19 nov), igual ao cartão de visita. Configurável pelo Administrador. */
export const DEFAULT_SIGNATURE = "{comercial} · {cargo}\nBASECOM · Intermediário exclusivo NOS\n{telemovel} · {email}\nSuporte: 926 543 124 · suporte@basecom.pt\nbasecom.pt";
export type SignatureVars = { comercial: string; cargo?: string | null; telemovel?: string | null; email?: string | null };
/** Sem cargo nem telemóvel, a pessoa ainda não tem assinatura (devolve null). Linhas com campos vazios desaparecem. */
export function renderSignature(tpl: string, v: SignatureVars): string | null {
  if (!v.cargo && !v.telemovel) return null;
  const tel = (v.telemovel ?? "").replace(/\D/g, "").replace(/^351/, "");
  const fmt = /^\d{9}$/.test(tel) ? `${tel.slice(0, 3)} ${tel.slice(3, 6)} ${tel.slice(6)}` : v.telemovel ?? "";
  const vals: Record<string, string> = { comercial: v.comercial, cargo: v.cargo ?? "", telemovel: fmt, email: v.email ?? "" };
  return tpl.split("\n").map((line) => {
    const fields = [...line.matchAll(/\{(comercial|cargo|telemovel|email)\}/g)].map((m) => m[1]!);
    let out = line.replace(/\{(comercial|cargo|telemovel|email)\}/g, (_, k: string) => vals[k] ?? "");
    out = out.replace(/(\s·\s)+$/, "").replace(/^(\s·\s)+/, "").replace(/\s·\s(\s·\s)+/g, " · ").trim();
    return fields.length && fields.every((k) => !vals[k]) ? "" : out;
  }).filter((l) => l.length > 0).join("\n");
}
