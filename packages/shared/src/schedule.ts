/**
 * Horário de trabalho (CLAUDE.md): segunda a sexta 08h45–19h35; sábado 08h45–13h00; hora de Lisboa.
 * Usado para que as novas tentativas e os callbacks automáticos caiam sempre dentro do horário.
 */
export type WorkingHours = { weekday: [string, string]; saturday: [string, string] | null };
export const DEFAULT_WORKING_HOURS: WorkingHours = { weekday: ["08:45", "19:35"], saturday: ["08:45", "13:00"] };
const TZ = "Europe/Lisbon";

/** Partes da data em hora de Lisboa. */
function lisbon(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!);
  return { y: +p.year!, m: +p.month!, d: +p.day!, hm: `${p.hour}:${p.minute}`, dow };
}

/** Instante UTC de uma hora local de Lisboa num dado dia. */
function atLisbon(y: number, m: number, d: number, hm: string): Date {
  const [h, mi] = hm.split(":").map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi));
  // Diferença entre o relógio de Lisboa e UTC nesse instante (0 h no inverno, +1 h no verão).
  const l = lisbon(guess);
  const [lh, lm] = l.hm.split(":").map(Number) as [number, number];
  const diff = (lh * 60 + lm) - (h * 60 + mi) + (l.d !== d ? (l.d > d ? 1440 : -1440) : 0);
  return new Date(guess.getTime() - diff * 60_000);
}

function hoursFor(dow: number, wh: WorkingHours) {
  if (dow >= 1 && dow <= 5) return wh.weekday;
  if (dow === 6) return wh.saturday;
  return null;
}

/** Se a data cair fora do horário, passa para o início do período de trabalho seguinte. */
export function nextWorkingMoment(date: Date, wh: WorkingHours = DEFAULT_WORKING_HOURS): Date {
  let cursor = date;
  for (let i = 0; i < 8; i++) {
    const l = lisbon(cursor);
    const h = hoursFor(l.dow, wh);
    if (h) {
      const start = atLisbon(l.y, l.m, l.d, h[0]);
      const end = atLisbon(l.y, l.m, l.d, h[1]);
      if (cursor < start) return start;
      if (cursor < end) return cursor;
    }
    // Dia seguinte, à meia-noite de Lisboa.
    const next = new Date(Date.UTC(l.y, l.m - 1, l.d) + 86_400_000);
    cursor = atLisbon(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), "00:00");
  }
  return cursor;
}

/** Início do próximo dia de trabalho (para tentativas que passam para o dia seguinte). */
export function nextWorkingDayStart(date: Date, wh: WorkingHours = DEFAULT_WORKING_HOURS): Date {
  const l = lisbon(date);
  const tomorrow = new Date(Date.UTC(l.y, l.m - 1, l.d) + 86_400_000);
  return nextWorkingMoment(atLisbon(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), "00:00"), wh);
}

/** Dia (AAAA-MM-DD) em Lisboa — para contar as tentativas «no mesmo dia». */
export function lisbonDay(date: Date): string {
  const l = lisbon(date);
  return `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
}
