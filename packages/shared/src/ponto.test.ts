import { describe, expect, it } from "vitest";
import { fmtBalance, pontoDay } from "./ponto.js";

const t = (hm: string) => new Date(`2026-11-13T${hm}:00Z`);

describe("registo de ponto com almoço por saída e reentrada", () => {
  it("manhã + tarde = presença; o almoço é a maior pausa; saldo face às 8 h", () => {
    const d = pontoDay([
      { from: t("08:45"), to: t("10:30") }, { from: t("10:32"), to: t("13:00") }, // falha de 2 min: conta seguido
      { from: t("14:00"), to: t("16:00") }, { from: t("16:10"), to: t("17:45") }, // pausa de 10 min: não é almoço
    ], t("20:00"), 8 * 3600);
    expect(d.entrada).toEqual(t("08:45"));
    expect(d.saidaAlmoco).toEqual(t("13:00"));
    expect(d.regressoAlmoco).toEqual(t("14:00"));
    expect(d.saida).toEqual(t("17:45"));
    // Manhã 08:45–13:00 (a falha de 2 min conta) = 4h15; tarde 2h00 + 1h35 (a pausa de 10 min não conta) = 3h35 → 7h50.
    expect(d.presenceSeconds).toBe((255 + 215) * 60);
    expect(fmtBalance(d.balanceSeconds)).toBe("−0:10");
    expect(d.expectedExit).toBeNull();
  });
  it("ainda a trabalhar: mostra a hora de saída prevista para cumprir as horas", () => {
    const d = pontoDay([{ from: t("08:45"), to: t("13:00") }, { from: t("14:00"), to: null }], t("15:00"), 8 * 3600);
    expect(d.saida).toBeNull();
    expect(d.presenceSeconds).toBe((4 * 60 + 15 + 60) * 60);
    expect(d.expectedExit).toEqual(t("17:45")); // faltam 2h45
    expect(fmtBalance(3 * 60 + 40)).toBe("+0:04");
  });
});
