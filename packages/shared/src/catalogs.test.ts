import { describe, expect, it } from "vitest";
import { DEFAULT_OUTCOMES, DEFAULT_REASONS, OUTCOME_GROUPS, nextContactFor, operatorRefusalNote, opportunityAlert } from "./catalogs.js";

const r = (id: string) => DEFAULT_REASONS.find((x) => x.id === id)!;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;

describe("catálogos aprovados", () => {
  it("cada botão do Power Dialer abre os resultados da secção 14", () => {
    const by = (g: string) => DEFAULT_OUTCOMES.filter((o) => o.group === g).map((o) => o.label);
    expect(OUTCOME_GROUPS.map((g) => g.label)).toEqual(["Recusa", "Callback", "Não atende", "Proposta", "Venda", "Outro"]);
    expect(by("callback")).toEqual(["Ligar mais tarde", "Decisor ausente"]);
    expect(by("noanswer")).toEqual(["Não atendeu", "Ocupado", "Caixa de correio / Voicemail", "Número errado ou inexistente"]);
    expect(by("proposal")).toEqual(["Interessado", "Proposta enviada", "Em negociação"]);
    expect(by("other")).toEqual(["Empresa encerrada", "Não contactar / Oposição", "Empresa de outra carteira"]);
  });

  it("prazos dos motivos de recusa (3.4)", () => {
    const today = d("2026-11-11");
    expect(iso(nextContactFor(r("satisfied"), today).eligibleAt)).toBe("2027-02-09"); // 90 dias
    expect(iso(nextContactFor(r("no_need"), today).eligibleAt)).toBe("2027-05-10"); // 180 dias
    expect(iso(nextContactFor(r("decisor_undecided"), today).at)).toBe("2026-12-11"); // tarefa a 30 dias
    // Outra operadora (13 nov): fim da fidelização a 30/09/2027 → contacto 4 meses antes (30/05/2027), nos dois motivos.
    expect(iso(nextContactFor(r("loyal_other"), today, d("2027-09-30")).at)).toBe("2027-05-30");
    expect(iso(nextContactFor(r("chose_other"), today, d("2027-09-30")).at)).toBe("2027-05-30");
    expect(iso(nextContactFor(r("loyal_other"), today, d("2028-01-31")).at)).toBe("2027-09-30"); // fim de mês
    expect(operatorRefusalNote("MEO", "2027-09-30", 4)).toBe("Cliente da MEO até 30/09/2027, agendado contacto para 4 meses antes.");
    // NS/NR (decisão de 16 nov): sem data, contacto daqui a 6 meses; a operadora também pode ser NS/NR.
    expect(iso(nextContactFor(r("loyal_other"), today, null).at)).toBe(iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 6, today.getUTCDate()))));
    expect(operatorRefusalNote("MEO", "NS/NR", 4)).toBe("Cliente da MEO, fim da fidelização NS/NR, agendado contacto para daqui a 6 meses.");
    expect(operatorRefusalNote("NS/NR", "2027-09-30", 4)).toBe("Cliente de outra operadora (operadora NS/NR) até 30/09/2027, agendado contacto para 4 meses antes.");
    expect(operatorRefusalNote("NS/NR", null, 4)).toBe("Cliente de outra operadora (operadora NS/NR), fim da fidelização NS/NR, agendado contacto para daqui a 6 meses.");
  });
});

describe("regra dos sete dias das oportunidades", () => {
  const d0 = new Date("2026-11-02T10:00:00Z");
  const at = (days: number) => new Date(d0.getTime() + days * 86_400_000);
  it("alerta ao 5.º dia e atrasada ao 7.º; antes disso está em dia", () => {
    expect(opportunityAlert(d0, at(4.9)).level).toBe("ok");
    expect(opportunityAlert(d0, at(5))).toEqual({ days: 5, level: "warn" });
    expect(opportunityAlert(d0, at(6.9)).level).toBe("warn");
    expect(opportunityAlert(d0, at(7))).toEqual({ days: 7, level: "late" });
    expect(opportunityAlert(d0, at(30)).level).toBe("late");
  });
  it("respeita prazos configurados pelo Administrador", () => {
    expect(opportunityAlert(d0, at(3), { warnDays: 2, lateDays: 3, lostReopenDays: 180 }).level).toBe("late");
  });
});

import { recentLoyalty } from "./catalogs.js";
describe("Fidelizado recentemente (25 nov): contacto 8 meses depois do início do contrato", () => {
  const today = new Date(Date.UTC(2026, 10, 25));
  const d = (x: Date) => x.toISOString().slice(0, 10);
  it("36 meses, faltam 34 → fim daqui a 34 meses; liga daqui a 6 (quando faltarem 28)", () => {
    const r = recentLoyalty(today, 36, 34);
    expect(d(r.loyaltyEnd)).toBe("2029-09-25");
    expect(d(r.contactAt)).toBe("2027-05-25");
  });
  it("24 meses, faltam 22 → liga daqui a 6 (quando faltarem 16)", () => {
    expect(d(recentLoyalty(today, 24, 22).contactAt)).toBe("2027-05-25");
  });
  it("já faltam menos de 28 (de 36) → liga já", () => {
    expect(d(recentLoyalty(today, 36, 20).contactAt)).toBe("2026-11-25");
  });
});
