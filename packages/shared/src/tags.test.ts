import { describe, expect, it } from "vitest";
import { DEFAULT_CAMPAIGN_TAGS, mergeImportedTags } from "./tags.js";

const list = DEFAULT_CAMPAIGN_TAGS.flatMap((g) => g.tags);

describe("tags de campanha", () => {
  it("a lista tem as 38 tags, sem repetidas", () => {
    expect(list).toHaveLength(38);
    expect(new Set(list).size).toBe(38);
  });
  it("importar substitui as tags de campanha e mantém as de origem", () => {
    expect(mergeImportedTags(["Fim-Fid-Conc-0-3m", "Nome via nif.pt", "Zona-Porto"], ["Fim-Fid-Conc-3-6m", "Zona-Porto"], list))
      .toEqual(["Fim-Fid-Conc-3-6m", "Nome via nif.pt", "Zona-Porto"]);
  });
  it("célula vazia tira as tags de campanha; sem coluna Tags não mexe", () => {
    expect(mergeImportedTags(["MJ", "Nome via nif.pt"], [], list)).toEqual(["Nome via nif.pt"]);
    expect(mergeImportedTags(["MJ"], null, list)).toEqual(["MJ"]);
  });
});
