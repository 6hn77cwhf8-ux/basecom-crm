/**
 * Tags de campanha (lista do Leonardo, 23/11/2026). São calculadas no ficheiro da base;
 * o CRM importa-as e usa-as no filtro «Tags» das campanhas. Configuráveis pelo Administrador.
 */
export type TagGroup = { name: string; tags: string[] };

export const DEFAULT_CAMPAIGN_TAGS: TagGroup[] = [
  { name: "Momento", tags: ["Renov-NOS-Janela-9m", "Sem-Fid", "Sem-Fid-Desatualizado", "Fim-Fid-Conc-0-3m", "Fim-Fid-Conc-3-6m", "Fim-Fid-Conc-6-12m", "Agendado-Futuro"] },
  { name: "Situação", tags: ["NC-Ativo", "NN-Prospect", "Ex-Cliente-NOS", "MJ"] },
  { name: "Produto", tags: ["P-4P", "P-NCP", "P-5P", "P-3P", "P-2P", "P-PMP", "P-Alarme"] },
  { name: "Oportunidade", tags: ["Retenção-Valor-Alto", "Up-IM", "Up-Central-Pro", "Up-Migrar-FTTH", "Up-Alarme", "Up-Móveis", "Up-TV"] },
  { name: "Setor", tags: ["Setor-Serviços", "Setor-Comércio", "Setor-Construção", "Setor-Indústria", "Setor-Saúde", "Setor-Restauração", "Setor-Transportes", "Setor-Educação"] },
  { name: "Zona", tags: ["Zona-Porto", "Zona-Aveiro", "Zona-Norte", "Zona-Lisboa-Centro", "Zona-Sul"] },
];

/** Mínimo de empresas para uma tag poder ser usada numa campanha (abaixo disso é só informação). */
export const DEFAULT_TAG_MIN_COMPANIES = 250;

/** Novas tags de uma empresa ao importar: as de campanha passam a ser as do ficheiro; as outras mantêm-se. */
export function mergeImportedTags(current: string[], fromFile: string[] | null, campaignTags: string[]) {
  if (fromFile == null) return current;
  const isCampaign = new Set(campaignTags);
  return [...new Set([...current.filter((t) => !isCampaign.has(t)), ...fromFile])].sort();
}
