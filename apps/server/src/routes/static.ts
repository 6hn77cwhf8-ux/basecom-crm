import type { FastifyInstance } from "fastify";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

/**
 * Atualizações automáticas (17 nov 2026):
 * · /app/ — os ecrãs do programa do computador. O programa instalado abre esta página, por isso cada publicação
 *   chega a todos os computadores sem reinstalar.
 * · /android/version.json e /android/BASECOM.apk — a app Android vê se há versão nova e descarrega-a.
 * As pastas vêm de APP_DIR (dentro da imagem) e FILES_DIR (sincronizada pelo update.sh a partir do GitHub).
 */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".apk": "application/vnd.android.package-archive",
};

async function sendFile(root: string, rel: string, reply: import("fastify").FastifyReply, cache: string) {
  const full = normalize(join(root, rel));
  if (!full.startsWith(normalize(root) + sep) && full !== normalize(root)) return null;
  try {
    const s = await stat(full);
    if (!s.isFile()) return null;
    reply.header("content-type", TYPES[extname(full).toLowerCase()] ?? "application/octet-stream");
    reply.header("cache-control", cache);
    return reply.send(await readFile(full));
  } catch { return null; }
}

export async function staticRoutes(app: FastifyInstance, opts: { appDir: string; filesDir: string }) {
  const { appDir, filesDir } = opts;
  app.get("/app", async (_req, reply) => reply.redirect("/app/"));
  app.get("/app/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"] || "index.html";
    // Ficheiros com «hash» no nome nunca mudam: guarda-os muito tempo; a página inicial é sempre lida de novo.
    const sent = await sendFile(appDir, rel, reply, rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    if (sent) return sent;
    const index = await sendFile(appDir, "index.html", reply, "no-cache");
    return index ?? reply.code(404).send({ error: "O programa ainda não está disponível neste servidor." });
  });
  app.get("/android/version.json", async (_req, reply) => (await sendFile(join(filesDir, "android"), "version.json", reply, "no-cache")) ?? reply.code(404).send({ error: "Sem versão publicada." }));
  app.get("/android/BASECOM.apk", async (_req, reply) => {
    reply.header("content-disposition", 'attachment; filename="BASECOM.apk"');
    return (await sendFile(join(filesDir, "android"), "BASECOM.apk", reply, "no-cache")) ?? reply.code(404).send({ error: "Sem versão publicada." });
  });
}
