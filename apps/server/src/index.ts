import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const { db } = createDb(config.DATABASE_URL);
const app = buildApp({ db, encryptionKey: config.ENCRYPTION_KEY, logger: true });
await app.listen({ port: config.PORT, host: "0.0.0.0" });
