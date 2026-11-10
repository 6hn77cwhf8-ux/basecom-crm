import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { Db } from "./db/client.js";

describe("GET /health", () => {
  it("responde ok com o ciclo atual quando a base de dados responde", async () => {
    const db = { execute: async () => ({ rows: [] }) } as unknown as Db;
    const app = buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", database: "ok" });
    expect(res.json().cycle).toMatch(/^C\d{2}\/\d{4}$/);
  });
  it("responde 503 quando a base de dados falha", async () => {
    const db = { execute: async () => { throw new Error("sem ligação"); } } as unknown as Db;
    const res = await buildApp({ db }).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json().database).toBe("erro");
  });
});
