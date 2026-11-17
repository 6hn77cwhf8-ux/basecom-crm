/**
 * Mensagens rápidas (17 nov 2026): modelos de texto para WhatsApp, SMS e email, configuráveis pelo Administrador.
 * Campos automáticos: {decisor} {empresa} {op} {comercial}. Um campo sem valor desaparece da frase com o espaço à volta.
 */
export type MessageTemplate = { id: string; label: string; text: string; active: boolean };
export const MESSAGE_FIELDS = ["decisor", "empresa", "op", "comercial"] as const;
export type MessageVars = Partial<Record<(typeof MESSAGE_FIELDS)[number], string>>;

export const DEFAULT_MESSAGE_TEMPLATES: MessageTemplate[] = [
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

export function renderMessage(text: string, v: MessageVars): string {
  return text
    .replace(/\s*\(referência \{op\}\)/g, v.op ? ` (referência ${v.op})` : "")
    .replace(/\{(decisor|empresa|op|comercial)\}/g, (_, k: string) => (v as Record<string, string | undefined>)[k] ?? "")
    .replace(/ {2,}/g, " ").replace(/ ,/g, ",").replace(/ \./g, ".").trim();
}
