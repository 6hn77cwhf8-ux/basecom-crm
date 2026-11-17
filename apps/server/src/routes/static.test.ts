import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { staticRoutes } from "./static.js";

describe("ecrãs do programa e app Android servidos pelo servidor (atualização automática)", () => {
  const root = mkdtempSync(join(tmpdir(), "bc-static-"));
  const appDir = join(root, "app"), filesDir = join(root, "files");
  mkdirSync(join(appDir, "assets"), { recursive: true }); mkdirSync(join(filesDir, "android"), { recursive: true });
  writeFileSync(join(appDir, "index.html"), "<html>CRM</html>"); writeFileSync(join(appDir, "assets", "a-123.js"), "console.log(1)");
  writeFileSync(join(filesDir, "android", "version.json"), '{"versionCode":7}');
  const app = Fastify(); app.register(staticRoutes, { appDir, filesDir });

  it("serve a página, os ficheiros e não deixa sair da pasta", async () => {
    expect((await app.inject("/app/")).body).toBe("<html>CRM</html>");
    const js = await app.inject("/app/assets/a-123.js");
    expect(js.headers["cache-control"]).toContain("immutable");
    expect((await app.inject("/app/assets/../../files/android/version.json")).body).not.toContain("versionCode");
    expect((await app.inject("/app/%2e%2e/files/android/version.json")).body).not.toContain("versionCode");
    expect((await app.inject("/app/qualquer/ecra")).body).toBe("<html>CRM</html>");
    expect(JSON.parse((await app.inject("/android/version.json")).body)).toEqual({ versionCode: 7 });
    expect((await app.inject("/android/BASECOM.apk")).statusCode).toBe(404);
  });
});
