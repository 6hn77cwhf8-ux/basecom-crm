import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  main: {},
  // Com sandbox ativo, o Electron só aceita preload em CommonJS.
  preload: { build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } } },
  renderer: { plugins: [react()], define: { __APP_VERSION__: JSON.stringify(version) } },
});
