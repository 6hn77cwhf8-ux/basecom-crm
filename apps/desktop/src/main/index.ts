import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
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
  // Ligações «tel:», «mailto:» e páginas de fora (WhatsApp, etc.) abrem no programa do sistema.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(tel|mailto|https?):/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  // A janela só navega dentro do CRM; tudo o resto abre fora.
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(CRM_ORIGIN) || url.startsWith("data:") || url.startsWith("file:") || (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))) return;
    e.preventDefault();
    if (/^(tel|mailto|https?):/.test(url)) shell.openExternal(url);
  });
  // Sem internet ou servidor em baixo: página simples com «Tentar de novo».
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3 && !url.startsWith("data:")) win.loadURL(offlinePage());
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadURL(CRM_URL);
}

/**
 * Atualização automática (17 nov 2026): os ecrãs vêm do servidor (crm.basecom.pt/app/). Cada publicação chega a todos
 * os computadores da próxima vez que o CRM abrir, sem reinstalar. Este programa é só a «moldura».
 */
const CRM_URL = process.env.BASECOM_URL ?? "https://crm.basecom.pt/app/";
const CRM_ORIGIN = new URL(CRM_URL).origin;
function offlinePage() {
  const html = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>BASECOM CRM</title><style>
    body{margin:0;height:100vh;display:grid;place-items:center;background:#F5F5F7;color:#0B0B0B;font-family:-apple-system,"Segoe UI",sans-serif}
    main{background:#fff;border:1px solid #E5E5EA;border-radius:16px;padding:32px 36px;max-width:420px;text-align:center}
    h1{font-size:22px;margin:0 0 8px}p{color:#6E6E73;font-size:14px;line-height:20px}a{display:inline-block;margin-top:12px;background:#0B0B0B;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600}
  </style></head><body><main><h1>Sem ligação ao CRM</h1><p>Verifique a internet. O CRM abre assim que a ligação voltar.</p><a href="${CRM_URL}">Tentar de novo</a></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
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

// Versão deste programa (a «moldura»), para os ecrãs avisarem quando for preciso reinstalar.
ipcMain.on("shell-version", (e) => { e.returnValue = app.getVersion(); });

app.whenReady().then(() => {
  setMenu();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
