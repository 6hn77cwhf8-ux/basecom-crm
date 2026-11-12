import { app, BrowserWindow, Menu, shell } from "electron";
import { join } from "node:path";

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    title: "BASECOM CRM",
    webPreferences: { preload: join(__dirname, "../preload/index.cjs"), contextIsolation: true, sandbox: true },
  });
  // Ligações «tel:» e «mailto:» abrem no programa do sistema (Ligação ao Telemóvel / FaceTime, Outlook).
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(tel|mailto|https?):/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (/^(tel|mailto):/.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, "../renderer/index.html"));
}

/**
 * Menu sem os atalhos de anular/refazer ligados ao menu (⌘Z / Ctrl+Z): a aplicação trata-os ela própria,
 * para que durante uma chamada não façam nada (Teste 1, ponto 10.3).
 */
function setMenu() {
  const edit: Electron.MenuItemConstructorOptions = { label: "Editar", submenu: [
    { role: "undo", label: "Anular", registerAccelerator: false }, { role: "redo", label: "Refazer", registerAccelerator: false }, { type: "separator" },
    { role: "cut", label: "Cortar" }, { role: "copy", label: "Copiar" }, { role: "paste", label: "Colar" }, { role: "selectAll", label: "Selecionar tudo" },
  ] };
  const tpl: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    edit,
    { label: "Ver", submenu: [{ role: "resetZoom", label: "Tamanho normal" }, { role: "zoomIn", label: "Aumentar" }, { role: "zoomOut", label: "Diminuir" }, { type: "separator" }, { role: "togglefullscreen", label: "Ecrã inteiro" }] },
    { role: "windowMenu", label: "Janela" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(() => {
  setMenu();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
