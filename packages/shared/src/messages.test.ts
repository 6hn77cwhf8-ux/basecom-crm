import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TEMPLATES, renderMessage } from "./messages.js";

describe("mensagens rápidas", () => {
  it("preenche os campos e tira a referência quando não há OP", () => {
    const t = DEFAULT_MESSAGE_TEMPLATES.find((x) => x.id === "proposal")!.text;
    expect(renderMessage(t, { decisor: "Drª Sofia Exemplar", empresa: "Clínica Sorriso", op: "7590457", comercial: "Angela Dias" }))
      .toContain("para a Clínica Sorriso (referência 7590457).");
    expect(renderMessage(t, { decisor: "Drª Sofia", empresa: "Clínica Sorriso", comercial: "Angela Dias" })).toContain("para a Clínica Sorriso. Fico");
  });
});
