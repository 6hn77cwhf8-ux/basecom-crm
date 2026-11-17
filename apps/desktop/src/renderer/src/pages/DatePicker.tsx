import { useEffect, useRef, useState } from "react";
import { workingHoursFor } from "@basecom/shared";
import { c, input } from "../ui";

/**
 * Calendário do CRM (desenho aprovado a 17 nov 2026): dias do mês + horas de 30 em 30 minutos, compacto.
 * value: "AAAA-MM-DD" (só data) ou "AAAA-MM-DDTHH:mm" (com hora), na hora do computador (Lisboa).
 * min/max limitam os dias que se podem escolher (ex.: callback até 1 mês). workdaysOnly fecha os domingos
 * e só mostra as horas de trabalho de cada dia.
 */
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEK = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (v: string) => { const [y, m, d] = v.slice(0, 10).split("-").map(Number); return new Date(y!, (m ?? 1) - 1, d ?? 1); };

export function fmtPicked(v: string, withTime: boolean) {
  if (!v) return "";
  const d = parse(v);
  const base = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${WEEKDAY[d.getDay()]}, ${base} · ${v.slice(11, 16)}` : base;
}

/** Horas de 30 em 30 min dentro do horário do dia (09:00 até à última meia hora antes do fecho). */
function slotsFor(day: Date, workdaysOnly: boolean) {
  const h = workdaysOnly ? workingHoursFor(day.getDay()) : (["08:30", "20:00"] as [string, string]);
  if (!h) return [];
  const [oh, om] = h[0].split(":").map(Number) as [number, number];
  const [ch, cm] = h[1].split(":").map(Number) as [number, number];
  const open = oh * 60 + om, close = ch * 60 + cm;
  const out: string[] = [];
  for (let m = Math.ceil(open / 30) * 30; m <= close - 1 && m <= 19 * 60; m += 30) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  return out;
}

export function DatePicker({ value, onChange, withTime = false, min, max, workdaysOnly = false, disabled, placeholder = "Escolher data", ariaLabel, width = 230 }: {
  value: string; onChange: (v: string) => void; withTime?: boolean; min?: string; max?: string; workdaysOnly?: boolean;
  disabled?: boolean; placeholder?: string; ariaLabel?: string; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const start = value ? parse(value) : min ? parse(min) : new Date();
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const [day, setDay] = useState(value ? value.slice(0, 10) : "");
  const box = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // Fica por cima de tudo (janelas com barra de deslocamento não o cortam): posição calculada a partir do botão.
  const openAt = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const w = withTime ? 448 : 262, h = 330;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
      setPos({ top, left });
    }
    setOpen((o) => !o);
  };
  useEffect(() => { if (value) { setDay(value.slice(0, 10)); const d = parse(value); setView({ y: d.getFullYear(), m: d.getMonth() }); } }, [value]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("mousedown", close); window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc, true); };
  }, [open]);

  const today = ymd(new Date());
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= new Date(view.y, view.m + 1, 0).getDate(); d++) cells.push(new Date(view.y, view.m, d));
  const allowed = (d: Date) => {
    const k = ymd(d);
    if (min && k < min) return false;
    if (max && k > max) return false;
    if (workdaysOnly && !workingHoursFor(d.getDay())) return false;
    return true;
  };
  const move = (n: number) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const canPrev = !min || ymd(new Date(view.y, view.m, 0)) >= min;
  const canNext = !max || ymd(new Date(view.y, view.m + 1, 1)) <= max;
  const years: number[] = [];
  const y0 = min ? parse(min).getFullYear() : new Date().getFullYear() - 5;
  const y1 = max ? parse(max).getFullYear() : new Date().getFullYear() + 6;
  for (let y = y0; y <= y1; y++) years.push(y);

  const pickDay = (d: Date) => {
    const k = ymd(d);
    setDay(k);
    if (!withTime) { onChange(k); setOpen(false); }
  };
  const pickTime = (t: string) => { if (!day) return; onChange(`${day}T${t}`); setOpen(false); };
  const nowHm = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  const slots = day ? slotsFor(parse(day), workdaysOnly).filter((t) => day !== today || t > nowHm) : [];
  const nav = { border: 0, background: "transparent", cursor: "pointer", width: 28, height: 28, borderRadius: 8, fontSize: 16, color: c.ink } as const;

  return (
    <div ref={box} style={{ position: "relative", display: "inline-block" }}>
      <button ref={btnRef} type="button" aria-label={ariaLabel} disabled={disabled} onClick={openAt}
        style={{ ...input, width, height: 40, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: disabled ? "default" : "pointer", textAlign: "left", color: value ? c.ink : c.muted, opacity: disabled ? 0.5 : 1 }}>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value ? fmtPicked(value, withTime) : placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" /></svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Calendário" style={{ position: "fixed", zIndex: 200, top: pos.top, left: pos.left, background: c.card, border: `1px solid ${c.line}`, borderRadius: 14, boxShadow: "0 8px 28px rgba(0,0,0,.14)", padding: 12, display: "flex", gap: 12 }}>
          <div style={{ width: 236 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <button type="button" aria-label="Mês anterior" style={nav} disabled={!canPrev} onClick={() => move(-1)}>‹</button>
              <span style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13, fontWeight: 700 }}>
                {MONTHS[view.m]}
                {years.length > 2
                  ? <select aria-label="Ano" value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })} style={{ border: 0, background: "transparent", font: "inherit", fontWeight: 700, color: c.ink }}>{years.map((y) => <option key={y}>{y}</option>)}</select>
                  : <span>{view.y}</span>}
              </span>
              <button type="button" aria-label="Mês seguinte" style={nav} disabled={!canNext} onClick={() => move(1)}>›</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2, textAlign: "center", fontSize: 10, color: c.muted, marginBottom: 2 }}>
              {WEEK.map((w) => <span key={w}>{w}</span>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2 }}>
              {cells.map((d, i) => {
                if (!d) return <span key={i} />;
                const k = ymd(d), ok = allowed(d), on = k === day;
                return (
                  <button key={i} type="button" disabled={!ok} onClick={() => pickDay(d)}
                    style={{ height: 30, border: k === today && !on ? `1px solid ${c.line}` : 0, borderRadius: 7, cursor: ok ? "pointer" : "default", fontSize: 12, fontWeight: on ? 800 : 500,
                      background: on ? c.ink : ok ? c.surface : "transparent", color: on ? c.card : ok ? c.ink : c.line }}>{d.getDate()}</button>
                );
              })}
            </div>
          </div>
          {withTime && (
            <div style={{ width: 168, borderLeft: `1px solid ${c.line}`, paddingLeft: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <b style={{ fontSize: 12 }}>Hora</b>
              {!day ? <span style={{ fontSize: 12, color: c.muted }}>Escolha primeiro o dia.</span> : slots.length === 0 ? <span style={{ fontSize: 12, color: c.muted }}>Sem horas livres neste dia.</span> : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4, maxHeight: 230, overflow: "auto" }}>
                  {slots.map((t) => {
                    const on = value === `${day}T${t}`;
                    return <button key={t} type="button" onClick={() => pickTime(t)} style={{ height: 28, border: 0, borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: on ? 800 : 500, background: on ? c.ink : c.surface, color: on ? c.card : c.ink }}>{t}</button>;
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
