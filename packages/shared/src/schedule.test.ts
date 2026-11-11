import { describe, expect, it } from "vitest";
import { lisbonDay, nextWorkingDayStart, nextWorkingMoment } from "./schedule.js";

const z = (s: string) => new Date(s);
describe("horário de trabalho (Lisboa)", () => {
  it("dentro do horário fica igual; fora passa para o próximo início", () => {
    // Inverno (Lisboa = UTC). Quarta 11/11/2026.
    expect(nextWorkingMoment(z("2026-11-11T10:00:00Z")).toISOString()).toBe("2026-11-11T10:00:00.000Z");
    expect(nextWorkingMoment(z("2026-11-11T07:00:00Z")).toISOString()).toBe("2026-11-11T08:45:00.000Z");
    expect(nextWorkingMoment(z("2026-11-11T19:40:00Z")).toISOString()).toBe("2026-11-12T08:45:00.000Z");
    // Sábado depois das 13h → segunda.
    expect(nextWorkingMoment(z("2026-11-14T13:30:00Z")).toISOString()).toBe("2026-11-16T08:45:00.000Z");
    // Verão (Lisboa = UTC+1): 08h45 locais = 07h45 UTC.
    expect(nextWorkingMoment(z("2027-06-15T05:00:00Z")).toISOString()).toBe("2027-06-15T07:45:00.000Z");
  });
  it("dia seguinte de trabalho e dia de Lisboa", () => {
    expect(nextWorkingDayStart(z("2026-11-13T15:00:00Z")).toISOString()).toBe("2026-11-14T08:45:00.000Z"); // sexta → sábado
    expect(lisbonDay(z("2027-06-15T23:30:00Z"))).toBe("2027-06-16");
  });
});
