import { describe, expect, it } from "vitest";
import { DEFAULT_ATTEMPT_RULES, DEFAULT_OPPORTUNITY_RULES, DEFAULT_OUTCOMES, DEFAULT_REASONS, DEFAULT_TASK_TYPES } from "@basecom/shared";
import { checkCatalogs } from "./settings.js";

const base = () => structuredClone({ outcomes: DEFAULT_OUTCOMES, attempts: DEFAULT_ATTEMPT_RULES, reasons: DEFAULT_REASONS, opportunities: DEFAULT_OPPORTUNITY_RULES, taskTypes: DEFAULT_TASK_TYPES });

describe("catálogos editáveis pelo Administrador", () => {
  it("aceita mudar nomes, desativar resultados e criar motivos", () => {
    const v = base();
    v.outcomes[0]!.label = "Não quer"; v.outcomes[1]!.active = false;
    v.reasons.push({ id: "mudou_morada", label: "Mudou de morada", effect: "cooldown", days: 60, active: true });
    expect(() => checkCatalogs(v)).not.toThrow();
  });
  it("não deixa apagar resultados, mudar o que fazem, repetir motivos nem pôr o alerta depois do atraso", () => {
    const a = base(); a.outcomes = a.outcomes.filter((o) => o.id !== "sale");
    expect(() => checkCatalogs(a)).toThrow(/não pode ser apagado/);
    const b = base(); b.outcomes[0] = { ...b.outcomes[0]!, effect: "sale" };
    expect(() => checkCatalogs(b)).toThrow(/não pode ser mudado/);
    const c = base(); c.reasons.push({ ...c.reasons[0]! });
    expect(() => checkCatalogs(c)).toThrow(/repetidos/);
    const d = base(); d.opportunities = { warnDays: 7, lateDays: 7, lostReopenDays: 180 };
    expect(() => checkCatalogs(d)).toThrow(/alerta/);
  });
});
