/**
 * Previsão de pontos de uma proposta (regras aprovadas, CLAUDE.md):
 * pontos por € — NN 6 · XSell 3 · FID 1 · Upsell 0,5; carteira FC conta 50 %.
 * Uma proposta tem até 2 tipos (decisão de 17 nov): NN sozinho; FID pode juntar XSell ou Upsell; XSell e Upsell nunca juntos.
 * É uma previsão: os pontos reais saem da Receita Ponderada do RUN da NOS (Arranque B).
 */
export const SALE_KINDS = ["NN", "FID", "XSell", "Upsell"] as const;
export type SaleKind = (typeof SALE_KINDS)[number];
export type SaleTypes = Partial<Record<SaleKind, number>>;
export const POINTS_PER_EURO: Record<SaleKind, number> = { NN: 6, XSell: 3, FID: 1, Upsell: 0.5 };
/** Escalões (pontos → prémio): 2.750 → 150 € · 3.250 → 400 € · 3.750 → 700 € · 4.500 → 1.150 € · 5.500 → 1.700 €. */
export const TIERS: [number, number][] = [[2750, 150], [3250, 400], [3750, 700], [4500, 1150], [5500, 1700]];

/** Mensagem de erro se a combinação de tipos não for permitida; null se estiver certa. */
export function saleTypesError(t: SaleTypes): string | null {
  const kinds = SALE_KINDS.filter((k) => t[k] !== undefined);
  if (!kinds.length) return "Escolha o tipo de venda.";
  if (kinds.length > 2) return "No máximo 2 tipos por proposta.";
  if (kinds.includes("NN") && kinds.length > 1) return "NN é sempre sozinho.";
  if (kinds.includes("XSell") && kinds.includes("Upsell")) return "XSell e Upsell não vão juntos.";
  if (kinds.length === 2 && !kinds.includes("FID")) return "Dois tipos só com FID (FID + XSell ou FID + Upsell).";
  for (const k of kinds) if (!(Number(t[k]) > 0)) return `Indique o valor de ${k} (€/mês).`;
  return null;
}

export function proposalPoints(t: SaleTypes, walletKind: "NC" | "FC" = "NC"): number {
  let p = 0;
  for (const k of SALE_KINDS) if (t[k]) p += (t[k] as number) * POINTS_PER_EURO[k];
  return Math.round(p * (walletKind === "FC" ? 0.5 : 1));
}

/** Valor mensal da proposta para o Pipeline (soma dos valores indicados). */
export function proposalValue(t: SaleTypes): number {
  return Math.round(SALE_KINDS.reduce((a, k) => a + (t[k] ?? 0), 0) * 100) / 100;
}

/** Próximo escalão acima de um total de pontos (null se já passou o último). */
export function nextTier(points: number): { points: number; bonus: number } | null {
  const t = TIERS.find(([p]) => p > points);
  return t ? { points: t[0], bonus: t[1] } : null;
}

/**
 * Receita NOS da empresa (documento de faturação, só gerência): a NOS paga um multiplicador sobre o valor mensal do aditivo.
 * FID 1,5× · Upsell 1,5× · XSell 4,5× · NN 7,5× (o NN 8,5× por escalão de volume chega no Arranque B); FC conta metade.
 */
export const DEFAULT_NOS_MULTIPLIERS: Record<SaleKind, number> = { FID: 1.5, Upsell: 1.5, XSell: 4.5, NN: 7.5 };
export function nosRevenue(t: SaleTypes, walletKind: "NC" | "FC" = "NC", m: Record<SaleKind, number> = DEFAULT_NOS_MULTIPLIERS): number {
  let v = 0;
  for (const k of SALE_KINDS) if (t[k]) v += (t[k] as number) * (m[k] ?? 0);
  return Math.round(v * (walletKind === "FC" ? 0.5 : 1) * 100) / 100;
}
