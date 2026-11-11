import { describe, expect, it } from "vitest";
import { isValidNif, normalizeCompanyName, normalizeOperator, normalizePhone, splitHistory, splitSalutation, toEuros, toIsoDate } from "./companies.js";

describe("NIF", () => {
  it("valida pelo dígito de controlo (exemplos reais da base)", () => {
    expect(isValidNif("506379361")).toBe(true);
    expect(isValidNif("516268724")).toBe(true);
    expect(isValidNif("PT 506 417 816")).toBe(true);
    expect(isValidNif("506379362")).toBe(false);
    expect(isValidNif("12345")).toBe(false);
    expect(isValidNif(null)).toBe(false);
  });
});

describe("telefones", () => {
  it("normaliza para +351 e distingue móvel de fixo", () => {
    expect(normalizePhone("962687579")).toEqual({ e164: "+351962687579", national: "962687579", type: "mobile" });
    expect(normalizePhone("252 622 028")?.type).toBe("landline");
    expect(normalizePhone("+351 912 345 678")?.national).toBe("912345678");
    expect(normalizePhone("00351224441526")?.e164).toBe("+351224441526");
    expect(normalizePhone("800200200")?.type).toBe("other");
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("operadora", () => {
  it("aceita só a lista e normaliza sinónimos", () => {
    expect(normalizeOperator("VOD")).toEqual({ operator: "Vodafone", note: null });
    expect(normalizeOperator("vod").operator).toBe("Vodafone");
    expect(normalizeOperator("VDF").operator).toBe("Vodafone");
    expect(normalizeOperator("DIGGI").operator).toBe("DIGI");
    expect(normalizeOperator("MEO").operator).toBe("MEO");
  });
  it("passa notas e nomes de pessoas para as notas", () => {
    expect(normalizeOperator("ODETE")).toEqual({ operator: null, note: "ODETE" });
    expect(normalizeOperator("VOD/MEO")).toEqual({ operator: null, note: "VOD/MEO" });
    expect(normalizeOperator("")).toEqual({ operator: null, note: null });
  });
});

describe("outros campos", () => {
  it("separa o tratamento do nome do decisor", () => {
    expect(splitSalutation("Sr. Paulo Jorge da Costa Rebelo")).toEqual({ salutation: "Sr.", name: "Paulo Jorge da Costa Rebelo" });
    expect(splitSalutation("Senhora Jaime da Costa Oliveira")).toEqual({ salutation: "Senhora", name: "Jaime da Costa Oliveira" });
    expect(splitSalutation("Rui Silva")).toEqual({ salutation: null, name: "Rui Silva" });
  });
  it("compara nomes sem «Lda», «Limitada» nem acentos", () => {
    expect(normalizeCompanyName("Color - Sociedade Comercial de Vernizes, Lda.")).toBe(normalizeCompanyName("COLOR SOCIEDADE COMERCIAL DE VERNIZES LIMITADA"));
    expect(normalizeCompanyName("Clínica Corpusmed, Lda")).toBe("clinica corpusmed");
    expect(normalizeCompanyName("Alfa, Unipessoal, Lda")).toBe("alfa");
    expect(normalizeCompanyName("Beta, S.A.")).toBe("beta");
    expect(normalizeCompanyName("Ricardo Sá Pereira, Unipessoal, Lda")).not.toBe(normalizeCompanyName("Ricardo Pereira, Unipessoal, Lda"));
  });
  it("separa o histórico por «||»", () => {
    expect(splitHistory("LIGAR 06/05 || SEM CONTATO || NAO ATENDE")).toEqual(["LIGAR 06/05", "SEM CONTATO", "NAO ATENDE"]);
  });
  it("lê datas e valores do Excel", () => {
    expect(toIsoDate("2023-02-10")).toBe("2023-02-10");
    expect(toIsoDate("10/02/2023")).toBe("2023-02-10");
    expect(toIsoDate(44967)).toBe("2023-02-10");
    expect(toIsoDate("2028")).toBeNull();
    expect(toEuros(105)).toBe(105);
    expect(toEuros("1.234,56 €")).toBe(1234.56);
  });
});
