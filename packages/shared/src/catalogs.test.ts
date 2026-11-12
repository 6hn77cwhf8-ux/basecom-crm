import { describe, expect, it } from "vitest";
import { DEFAULT_OUTCOMES, DEFAULT_REASONS, OUTCOME_GROUPS, nextContactFor, opportunityAlert } from "./catalogs.js";

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
    // Fidelizado até 30/09/2027: primeiro contacto 6 meses antes.
    expect(iso(nextContactFor(r("loyal_other"), today, d("2027-09-30")).at)).toBe("2027-03-30");
    // Renovou em out/2026: contrato de 24 meses, contacto aos 18 meses (exemplo da maqueta: abr 2028).
    expect(iso(nextContactFor(r("chose_other"), today, d("2026-10-15")).at)).toBe("2028-04-15");
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
