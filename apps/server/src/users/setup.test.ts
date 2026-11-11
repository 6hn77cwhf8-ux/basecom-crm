import { describe, expect, it } from "vitest";
import { createDb } from "../db/client.js";
import { buildApp } from "../app.js";
import { setupToken } from "../routes/setup.js";

const url = process.env.DATABASE_URL;
const KEY = Buffer.alloc(32, 9).toString("base64");

describe.skipIf(!url)("primeiro administrador", () => {
  const { db } = createDb(url ?? "postgres://x@localhost/x");
  const app = buildApp({ db, encryptionKey: KEY });

  it("recusa um código de arranque errado", async () => {
    const r = await app.inject({ method: "POST", url: "/setup/first-admin", payload: { token: "x".repeat(64), name: "Teste", email: "t@basecom.pt" } });
    expect(r.statusCode).toBe(403);
  });

  it("o código depende da chave de cifra", () => {
    expect(setupToken(KEY)).toHaveLength(64);
    expect(setupToken(Buffer.alloc(32, 1).toString("base64"))).not.toBe(setupToken(KEY));
  });
});
