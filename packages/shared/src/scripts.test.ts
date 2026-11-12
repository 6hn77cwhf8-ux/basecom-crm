import { describe, expect, it } from "vitest";
import { DEFAULT_SCRIPTS, nboHead, renderScript, spokenName } from "./scripts.js";

describe("scripts em dois passos", () => {
  it("abertura com o tratamento falado do decisor", () => {
    expect(renderScript(DEFAULT_SCRIPTS.opening, { comercial: "Teste Comercial", empresa: "RAMADA DO MAR, LDA", decisor: spokenName("Srª", "Ana Sofia Oliveira da Silva Fernandes") }))
      .toBe("Olá, o meu nome é Teste Comercial e estava a entrar em contacto porque gostaria de falar com a pessoa responsável da empresa RAMADA DO MAR, LDA. Seria possível? Falo com a Senhora Dona Ana Sofia Oliveira da Silva Fernandes?");
    expect(spokenName("Sr.", "Rui Sá")).toBe("o Senhor Rui Sá");
    expect(spokenName(null, "Rui Sá")).toBe("Rui Sá");
  });
  it("campos em falta ficam visíveis para completar", () => {
    expect(renderScript("Falo com {decisor}? Campanha {campanha}", {})).toBe("Falo com [nome do responsável]? Campanha [campanha]");
  });
  it("campanha NBO sem as ofertas", () => {
    expect(nboHead("SOMA | Adicionar fixo — Adicione +1 cartão | Adicione IF")).toBe("SOMA · Adicionar fixo");
    expect(nboHead(null)).toBe("");
  });
});
