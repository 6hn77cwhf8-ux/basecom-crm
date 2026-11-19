import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TEMPLATES, DEFAULT_SIGNATURE, renderMessage, renderSignature } from "./messages.js";

describe("mensagens rápidas", () => {
  it("preenche os campos e tira a referência quando não há OP", () => {
    const t = DEFAULT_MESSAGE_TEMPLATES.find((x) => x.id === "proposal")!.text;
    expect(renderMessage(t, { decisor: "Drª Sofia Exemplar", empresa: "Clínica Sorriso", op: "7590457", comercial: "Angela Dias" }))
      .toContain("para a Clínica Sorriso (referência 7590457).");
    expect(renderMessage(t, { decisor: "Drª Sofia", empresa: "Clínica Sorriso", comercial: "Angela Dias" })).toContain("para a Clínica Sorriso. Fico");
  });
});

describe("assinatura (19 nov)", () => {
  it("igual ao cartão de visita, com o telemóvel formatado", () => {
    expect(renderSignature(DEFAULT_SIGNATURE, { comercial: "Ângela Dias", cargo: "Consultora Comercial", telemovel: "+351931045933", email: "angela@basecom.pt" }))
      .toBe("Ângela Dias · Consultora Comercial\nBASECOM · Intermediário exclusivo NOS\n931 045 933 · angela@basecom.pt\nSuporte: 926 543 124 · suporte@basecom.pt\nbasecom.pt");
  });
  it("sem cargo nem telemóvel não há assinatura; campos em falta desaparecem", () => {
    expect(renderSignature(DEFAULT_SIGNATURE, { comercial: "Catarina Machado" })).toBeNull();
    expect(renderSignature(DEFAULT_SIGNATURE, { comercial: "X", cargo: "Comercial" })!.split("\n")[2]).toBe("Suporte: 926 543 124 · suporte@basecom.pt");
  });
});
