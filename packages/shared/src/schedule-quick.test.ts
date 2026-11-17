import { describe, expect, it } from "vitest";
import { callbackLimit, quickCallbackAt } from "./schedule.js";

const lx = (iso: string) => new Date(iso); // datas em novembro: Lisboa = UTC
const iso = (d: Date) => d.toISOString().slice(0, 16);

describe("atalhos do callback (17 nov 2026)", () => {
  it("1 hora conta o horário de trabalho", () => {
    expect(iso(quickCallbackAt("1h", lx("2026-11-17T10:30:00Z")))).toBe("2026-11-17T11:30");
    expect(iso(quickCallbackAt("1h", lx("2026-11-17T19:00:00Z")))).toBe("2026-11-18T08:45"); // depois das 19h35
    expect(iso(quickCallbackAt("1h", lx("2026-11-21T12:30:00Z")))).toBe("2026-11-23T08:45"); // sábado depois das 13h
  });
  it("1 dia e 1 semana mantêm a hora; domingo passa para segunda", () => {
    expect(iso(quickCallbackAt("1d", lx("2026-11-17T10:30:00Z")))).toBe("2026-11-18T10:30");
    expect(iso(quickCallbackAt("1d", lx("2026-11-21T10:30:00Z")))).toBe("2026-11-23T10:30"); // sábado → segunda
    expect(iso(quickCallbackAt("1w", lx("2026-11-17T15:00:00Z")))).toBe("2026-11-24T15:00");
  });
  it("1 mês nunca passa do limite (dia fechado → dia útil anterior)", () => {
    expect(iso(quickCallbackAt("1m", lx("2026-11-17T10:30:00Z")))).toBe("2026-12-17T10:30");
    expect(iso(quickCallbackAt("1m", lx("2026-11-06T15:00:00Z")))).toBe("2026-12-04T15:00"); // 06/12 é domingo; sábado às 15h está fechado → sexta
    expect(quickCallbackAt("1m", lx("2026-11-06T15:00:00Z")) <= callbackLimit(lx("2026-11-06T15:00:00Z"))).toBe(true);
    expect(iso(callbackLimit(lx("2027-01-31T10:00:00Z")))).toBe("2027-02-28T23:59");
  });
});
