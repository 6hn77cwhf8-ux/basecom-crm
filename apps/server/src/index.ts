import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const { db } = createDb(config.DATABASE_URL);
const app = buildApp({ db, logger: true });
await app.listen({ port: config.PORT, host: "0.0.0.0" });
