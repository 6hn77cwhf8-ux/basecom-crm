import { describe, expect, it } from "vitest";
import { nextTier, nosRevenue, proposalPoints, proposalValue, saleTypesError } from "./points.js";

describe("previsão de pontos (17 nov 2026)", () => {
  it("pontos por € e FC a 50 %", () => {
    expect(proposalPoints({ NN: 129 })).toBe(774);
    expect(proposalPoints({ FID: 129.9, XSell: 35.5 })).toBe(236);
    expect(proposalPoints({ FID: 100, Upsell: 20 })).toBe(110);
    expect(proposalPoints({ NN: 129 }, "FC")).toBe(387);
    expect(proposalValue({ FID: 129.9, XSell: 35.5 })).toBe(165.4);
  });
  it("combinações: NN sozinho; FID + XSell ou FID + Upsell; nunca XSell + Upsell", () => {
    expect(saleTypesError({ NN: 50 })).toBeNull();
    expect(saleTypesError({ FID: 50, XSell: 10 })).toBeNull();
    expect(saleTypesError({ NN: 50, FID: 10 })).toMatch(/NN/);
    expect(saleTypesError({ XSell: 50, Upsell: 10 })).toMatch(/XSell e Upsell/);
    expect(saleTypesError({})).toMatch(/tipo/);
    expect(saleTypesError({ FID: 0 })).toMatch(/valor/);
  });
  it("próximo escalão", () => {
    expect(nextTier(2156)).toEqual({ points: 2750, bonus: 150 });
    expect(nextTier(2750)).toEqual({ points: 3250, bonus: 400 });
    expect(nextTier(6000)).toBeNull();
  });
});

describe("receita NOS (documento de faturação)", () => {
  it("100 € de aditivo: FID 150 €, Upsell 150 €, XSell 450 €, NN 750 €; FC metade", () => {
    expect(nosRevenue({ FID: 100 })).toBe(150);
    expect(nosRevenue({ Upsell: 100 })).toBe(150);
    expect(nosRevenue({ XSell: 100 })).toBe(450);
    expect(nosRevenue({ NN: 100 })).toBe(750);
    expect(nosRevenue({ NN: 100 }, "FC")).toBe(375);
    expect(nosRevenue({ FID: 100, XSell: 40 })).toBe(330);
  });
});
