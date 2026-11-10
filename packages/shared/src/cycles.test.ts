import { describe, expect, it } from "vitest";
import { cycleForDate } from "./cycles.js";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

describe("cycleForDate", () => {
  it("C1/2026 começa a 5 de janeiro de 2026", () => {
    const c = cycleForDate(d("2026-01-05"));
    expect(c.label).toBe("C01/2026");
    expect(day(c.start)).toBe("2026-01-05");
    expect(day(c.end)).toBe("2026-02-01");
  });
  it("10 de novembro de 2026 está no C12 (9 nov a 6 dez)", () => {
    const c = cycleForDate(d("2026-11-10"));
    expect(c.label).toBe("C12/2026");
    expect(day(c.start)).toBe("2026-11-09");
    expect(day(c.end)).toBe("2026-12-06");
  });
  it("C11/2026 vai de 12 de outubro a 8 de novembro", () => {
    expect(cycleForDate(d("2026-11-08")).label).toBe("C11/2026");
    expect(day(cycleForDate(d("2026-10-12")).start)).toBe("2026-10-12");
  });
  it("o dia anterior ao C1/2026 é C13/2025", () => {
    expect(cycleForDate(d("2026-01-04")).label).toBe("C13/2025");
  });
  it("depois do C13/2026 vem o C1/2027 (pressuposto a confirmar)", () => {
    expect(cycleForDate(d("2027-01-04")).label).toBe("C01/2027");
  });
});
