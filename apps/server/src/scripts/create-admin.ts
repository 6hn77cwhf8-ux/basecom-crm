/**
 * Cria o primeiro Administrador. Uso:
 *   pnpm --filter @basecom/server create-admin "Leonardo Rocha" email@basecom.pt
 * Mostra uma palavra-passe provisória (uma única vez). Na primeira entrada ativa-se a 2FA.
 */
import { randomBytes } from "node:crypto";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { hashPassword } from "../auth/service.js";

const [name, email] = process.argv.slice(2);
if (!name || !email) {
  console.error('Uso: create-admin "Nome" email');
  process.exit(1);
}
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const password = randomBytes(9).toString("base64url");
await db.insert(users).values({ name, email: email.toLowerCase(), role: "admin", passwordHash: await hashPassword(password) });
await pool.end();
console.log(`Administrador criado: ${email}\nPalavra-passe provisória: ${password}\nGuarde-a agora: não volta a ser mostrada.`);
