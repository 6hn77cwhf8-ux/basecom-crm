import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { AuthError } from "../auth/service.js";
import { l2bSchema } from "./opportunities.js";
import { daySummary, endClient, giveUpClient, heartbeat, pontoRows, setState, startClient, teamToday } from "../time/service.js";
import ExcelJS from "exceljs";
import { canSee } from "../teams/service.js";

/** Estados (A trabalhar, Formação, Intervalo, Mudança de campanha) e ponto. */
export async function timeRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  app.post("/time/heartbeat", any, async (req) => ({ state: await heartbeat(db, req.user!) }));
  app.post("/time/state", any, async (req) => {
    const b = z.object({ state: z.enum(["working", "training", "break", "switch", "office", "support"]), userId: z.string().uuid().optional() }).parse(req.body);
    await setState(db, req.user!, b.userId ?? req.user!.id, b.state);
    return daySummary(db, b.userId ?? req.user!.id);
  });
  // Em cliente (proposta ou venda) sem chamada: empresa, tipo e OP; a oportunidade fica com a OP.
  app.post("/time/client", any, async (req) => {
    const b = z.object({ companyId: z.string().uuid(), kind: z.enum(["proposal", "sale"]), opCode: z.string() }).parse(req.body);
    return startClient(db, req.user!, { ...b, withOpportunity: true });
  });
  app.post("/time/client/give-up", any, async (req) => {
    const b = z.object({ reasonId: z.string().min(1), comment: z.string().max(1000).optional(), operator: z.string().max(40).optional(), date: z.union([z.string().date(), z.literal("NS/NR")]).optional(), l2b: l2bSchema }).parse(req.body);
    return giveUpClient(db, req.user!, b);
  });
  app.post("/time/client/end", any, async (req) => {
    const b = z.object({
      saleTypes: z.object({ NN: z.number().min(0).max(100_000).optional(), FID: z.number().min(0).max(100_000).optional(), XSell: z.number().min(0).max(100_000).optional(), Upsell: z.number().min(0).max(100_000).optional() }),
      channel: z.string().max(40).optional(), followUp: z.enum(["call", "sms", "email", "whatsapp"]).optional(), at: z.string().datetime().optional(), comment: z.string().max(2000).optional(),
      l2b: l2bSchema,
    }).optional().parse(req.body ?? undefined);
    return endClient(db, req.user!, b);
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
    // Uma folha por comercial; só o tempo de login (entrada até saída, sem o almoço); totais de dias e horas no fim.
    const wb = new ExcelJS.Workbook();
    const byName = new Map<string, typeof rows>();
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
    const used = new Set<string>();
    for (const [name, list] of byName) {
      let sheetName = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Comercial";
      for (let k = 2; used.has(sheetName); k++) sheetName = `${sheetName.slice(0, 28)} ${k}`;
      used.add(sheetName);
      const ws = wb.addWorksheet(sheetName);
      ws.columns = [
        { header: "Data", key: "day", width: 12 }, { header: "Entrada", key: "in", width: 10 }, { header: "Saída almoço", key: "lo", width: 13 },
        { header: "Regresso almoço", key: "li", width: 15 }, { header: "Saída", key: "out", width: 10 }, { header: "Tempo de login", key: "pres", width: 15 },
      ];
      ws.getRow(1).font = { bold: true };
      let total = 0;
      for (const r of list) {
        const p = r.d.ponto;
        total += p.presenceSeconds;
        ws.addRow({ day: r.day.split("-").reverse().join("/"), in: hm(p.entrada), lo: hm(p.saidaAlmoco), li: hm(p.regressoAlmoco), out: hm(p.saida), pres: hhmm(p.presenceSeconds) });
      }
      ws.addRow({});
      ws.addRow({ day: "Dias de trabalho", pres: list.length }).font = { bold: true };
      ws.addRow({ day: "Total de horas", pres: hhmm(total) }).font = { bold: true };
    }
    if (!byName.size) wb.addWorksheet("Ponto").addRow(["Sem registos neste período."]);
    const buf = await wb.xlsx.writeBuffer();
    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", `attachment; filename="ponto_${q.from}_${q.to}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });
}
