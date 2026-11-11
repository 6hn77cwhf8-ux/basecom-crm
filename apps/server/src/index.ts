import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";
import { applyDueWalletChanges } from "./companies/wallet.js";

const config = loadConfig();
const { db } = createDb(config.DATABASE_URL);
const app = buildApp({ db, encryptionKey: config.ENCRYPTION_KEY, logger: true });
await app.listen({ port: config.PORT, host: "0.0.0.0" });

// Transferências de carteira agendadas para o início de um ciclo: aplicam-se sozinhas.
const tick = () => applyDueWalletChanges(db).then((n) => n && app.log.info(`Carteira: ${n} transferência(s) aplicada(s)`)).catch((e) => app.log.error(e));
tick();
setInterval(tick, 10 * 60_000);
