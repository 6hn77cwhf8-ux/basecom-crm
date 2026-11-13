/**
 * Registo de ponto (revisão de 13 nov): o almoço é reconhecido sozinho quando o comercial sai do CRM e volta a entrar.
 * Os períodos do dia juntam-se em blocos (falhas até 5 min contam como seguidas); a maior pausa de pelo menos 20 min
 * entre blocos é o almoço. Presença = soma dos blocos; saldo = presença − horas previstas do dia.
 */
export type Period = { from: Date; to: Date | null };
export type PontoDay = {
  entrada: Date | null; saidaAlmoco: Date | null; regressoAlmoco: Date | null; saida: Date | null;
  presenceSeconds: number; expectedSeconds: number; balanceSeconds: number;
  /** Hora a que cumpre as horas previstas, se ainda estiver a trabalhar. */
  expectedExit: Date | null;
};

const JOIN_GAP_MS = 5 * 60_000;
const LUNCH_MIN_MS = 20 * 60_000;

export function pontoDay(periods: Period[], now: Date, expectedSeconds: number): PontoDay {
  const ps = [...periods].sort((a, b) => a.from.getTime() - b.from.getTime());
  const blocks: { from: Date; to: Date; open: boolean }[] = [];
  for (const p of ps) {
    const to = p.to ?? now;
    const last = blocks[blocks.length - 1];
    if (last && p.from.getTime() - last.to.getTime() <= JOIN_GAP_MS) {
      if (to > last.to) last.to = to;
      last.open = last.open || !p.to;
    } else blocks.push({ from: p.from, to, open: !p.to });
  }
  const presenceSeconds = Math.round(blocks.reduce((s, b) => s + (b.to.getTime() - b.from.getTime()), 0) / 1000);
  let lunch = -1;
  let longest = 0;
  for (let i = 1; i < blocks.length; i++) {
    const gap = blocks[i]!.from.getTime() - blocks[i - 1]!.to.getTime();
    if (gap >= LUNCH_MIN_MS && gap > longest) { longest = gap; lunch = i; }
  }
  const open = blocks.some((b) => b.open);
  const balanceSeconds = presenceSeconds - expectedSeconds;
  return {
    entrada: blocks[0]?.from ?? null,
    saidaAlmoco: lunch > 0 ? blocks[lunch - 1]!.to : null,
    regressoAlmoco: lunch > 0 ? blocks[lunch]!.from : null,
    saida: blocks.length && !open ? blocks[blocks.length - 1]!.to : null,
    presenceSeconds, expectedSeconds, balanceSeconds,
    expectedExit: open ? new Date(now.getTime() + Math.max(0, -balanceSeconds) * 1000) : null,
  };
}

/** «+0:25» ou «−1:10» (horas:minutos). */
export function fmtBalance(seconds: number): string {
  const sign = seconds < 0 ? "−" : "+";
  const m = Math.round(Math.abs(seconds) / 60);
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
