import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { AuthError } from "../auth/service.js";
import { daySummary, heartbeat, pontoRows, setState, teamToday } from "../time/service.js";
import ExcelJS from "exceljs";
import { fmtBalance } from "@basecom/shared";
import { canSee } from "../teams/service.js";

/** Estados (A trabalhar, Formação, Intervalo, Mudança de campanha) e ponto. */
export async function timeRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  app.post("/time/heartbeat", any, async (req) => ({ state: await heartbeat(db, req.user!) }));
  app.post("/time/state", any, async (req) => {
    const b = z.object({ state: z.enum(["working", "training", "break", "switch"]), userId: z.string().uuid().optional() }).parse(req.body);
    await setState(db, req.user!, b.userId ?? req.user!.id, b.state);
    return daySummary(db, b.userId ?? req.user!.id);
  });
  app.get("/time/today", any, async (req) => {
    const { userId } = z.object({ userId: z.string().uuid().optional() }).parse(req.query);
    if (userId && !(await canSee(db, req.user!, userId))) throw new AuthError(403, "Só vê os tempos da sua equipa.");
    return daySummary(db, userId ?? req.user!.id);
  });
  app.get("/time/team", any, async (req) => ({ people: await teamToday(db, req.user!) }));
  // Exportar o ponto para Excel (Chefe de Equipa: a sua equipa; Administrador: todos).
  app.get("/time/export", any, async (req, reply) => {
    const q = z.object({ from: z.string().date(), to: z.string().date() }).parse(req.query);
    if (q.to < q.from || (new Date(q.to).getTime() - new Date(q.from).getTime()) / 86_400_000 > 62) throw new AuthError(400, "Escolha um período até 2 meses.");
    const rows = await pontoRows(db, req.user!, q.from, q.to);
    const hm = (d: Date | string | null) => (d ? new Date(d).toLocaleTimeString("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" }) : "");
    const hhmm = (s: number) => `${Math.floor(s / 3600)}:${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Ponto");
    ws.columns = [
      { header: "Data", key: "day", width: 12 }, { header: "Comercial", key: "name", width: 24 },
      { header: "Entrada", key: "in", width: 10 }, { header: "Saída almoço", key: "lo", width: 13 }, { header: "Regresso almoço", key: "li", width: 15 },
      { header: "Saída", key: "out", width: 10 }, { header: "Presença", key: "pres", width: 10 }, { header: "Previsto", key: "exp", width: 10 },
      { header: "Saldo", key: "bal", width: 10 }, { header: "Intervalo", key: "brk", width: 10 }, { header: "Formação", key: "trn", width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const p = r.d.ponto;
      ws.addRow({ day: r.day.split("-").reverse().join("/"), name: r.name, in: hm(p.entrada), lo: hm(p.saidaAlmoco), li: hm(p.regressoAlmoco), out: hm(p.saida),
        pres: hhmm(p.presenceSeconds), exp: hhmm(p.expectedSeconds), bal: fmtBalance(p.balanceSeconds), brk: hhmm(r.d.seconds.break), trn: hhmm(r.d.seconds.training) });
    }
    const buf = await wb.xlsx.writeBuffer();
    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", `attachment; filename="ponto_${q.from}_${q.to}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });
}
