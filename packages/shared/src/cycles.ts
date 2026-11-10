/**
 * Ciclos comerciais de 28 dias.
 * Regra aprovada: C1/2026 começa a 5 de janeiro de 2026.
 * Pressuposto a confirmar: cada ano tem 13 ciclos seguidos (os ficheiros NOS usam 2025/C13),
 * por isso C1/2027 começa a seguir ao fim de C13/2026. O calendário será configurável.
 */
export const CYCLE_DAYS = 28;
export const CYCLES_PER_YEAR = 13;
const ANCHOR = Date.UTC(2026, 0, 5); // C1/2026
const DAY_MS = 86_400_000;

export interface Cycle {
  year: number;
  number: number; // 1..13
  start: Date; // primeiro dia (UTC, 00:00)
  end: Date; // último dia (UTC, 00:00)
  label: string; // ex.: "C12/2026"
}

function toUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function cycleFromIndex(index: number): Cycle {
  // index 0 = C1/2026; negativos = ciclos anteriores
  const year = 2026 + Math.floor(index / CYCLES_PER_YEAR);
  const number = (((index % CYCLES_PER_YEAR) + CYCLES_PER_YEAR) % CYCLES_PER_YEAR) + 1;
  const start = new Date(ANCHOR + index * CYCLE_DAYS * DAY_MS);
  const end = new Date(start.getTime() + (CYCLE_DAYS - 1) * DAY_MS);
  return { year, number, start, end, label: `C${String(number).padStart(2, "0")}/${year}` };
}

/** Ciclo a que pertence uma data (ex.: a data de ativação de uma venda). */
export function cycleForDate(date: Date): Cycle {
  const days = Math.floor((toUtcDay(date) - ANCHOR) / DAY_MS);
  return cycleFromIndex(Math.floor(days / CYCLE_DAYS));
}
