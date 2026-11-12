import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { agendaPeople, callFromTask, closeTask, createTask, listAgenda, rescheduleTask } from "../agenda/service.js";

/** Agenda: cada um sobre as suas tarefas; o Administrador consulta e cria para qualquer pessoa. */
export async function agendaRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const any = { preHandler: requireAuth(db) };
  const admin = { preHandler: requireAuth(db, ["admin"]) };
  const id = z.object({ id: z.string().uuid() });
  const instant = z.string().datetime({ offset: true });

  app.get("/agenda", any, async (req) => ({ tasks: await listAgenda(db, req.user!, z.object({ userId: z.string().uuid().optional() }).parse(req.query)) }));
  app.get("/agenda/people", admin, async () => ({ people: await agendaPeople(db) }));
  app.post("/agenda/tasks", any, async (req) => {
    const b = z.object({ companyId: z.string().uuid(), type: z.string().min(1).max(60), dueAt: instant, description: z.string().max(1000).optional(), assignedTo: z.string().uuid().optional() }).parse(req.body);
    return createTask(db, req.user!, b);
  });
  app.post("/agenda/tasks/:id/reschedule", any, async (req) => {
    const b = z.object({ dueAt: instant, reason: z.string().max(500) }).parse(req.body);
    await rescheduleTask(db, req.user!, id.parse(req.params).id, b.dueAt, b.reason); return { ok: true };
  });
  app.post("/agenda/tasks/:id/close", any, async (req) => {
    const b = z.object({ status: z.enum(["done", "cancelled"]), note: z.string().max(500).optional() }).parse(req.body);
    await closeTask(db, req.user!, id.parse(req.params).id, b.status, b.note); return { ok: true };
  });
  app.post("/agenda/tasks/:id/call", any, async (req) => callFromTask(db, req.user!, id.parse(req.params).id));
}
