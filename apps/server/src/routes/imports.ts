import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { requireAuth } from "./auth.js";
import { verifyStepUp } from "../auth/service.js";
import { commitBase, discardBatch, listBatchRows, listBatches, previewBase, revertBatch, uploadBase } from "../imports/base.js";

const MAX_FILE = 40 * 1024 * 1024;

/** Importação de ficheiros: só o Administrador; gravar e anular pedem o código 2FA. */
export async function importRoutes(app: FastifyInstance, opts: { db: Db; encryptionKey: string }) {
  const { db, encryptionKey } = opts;
  const admin = { preHandler: requireAuth(db, ["admin"]) };
  const id = z.object({ id: z.string().uuid() });
  const code = z.object({ code: z.string().min(6).max(8) });

  // O ficheiro chega tal como está (sem conversões); o nome vem num cabeçalho.
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_FILE }, (_req, body, done) => done(null, body));

  app.get("/imports", admin, async () => ({ batches: await listBatches(db) }));

  app.post("/imports/base", { ...admin, bodyLimit: MAX_FILE }, async (req) => {
    const name = decodeURIComponent(String(req.headers["x-file-name"] ?? "ficheiro.xlsx")).slice(0, 200);
    return uploadBase(db, req.user!.id, name, req.body as Buffer);
  });

  app.post("/imports/:id/preview", admin, async (req) => {
    const b = z.object({
      sheets: z.record(z.string(), z.enum(["import", "review", "skip"])),
      mapping: z.record(z.string(), z.string()),
      limit: z.number().int().min(1).max(100000).nullable(),
    }).parse(req.body);
    return previewBase(db, req.user!.id, id.parse(req.params).id, b);
  });

  app.get("/imports/:id/rows", admin, async (req) => {
    const q = z.object({ result: z.string().optional(), search: z.string().max(100).optional(), offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
    return listBatchRows(db, id.parse(req.params).id, q);
  });

  app.post("/imports/:id/commit", admin, async (req) => {
    await verifyStepUp(db, encryptionKey, req.user!.id, code.parse(req.body).code, "importacao");
    return commitBase(db, req.user!.id, id.parse(req.params).id);
  });

  app.post("/imports/:id/revert", admin, async (req) => {
    await verifyStepUp(db, encryptionKey, req.user!.id, code.parse(req.body).code, "anular_lote");
    return revertBatch(db, req.user!.id, id.parse(req.params).id);
  });

  app.post("/imports/:id/discard", admin, async (req) => { await discardBatch(db, req.user!.id, id.parse(req.params).id); return { ok: true }; });
}
