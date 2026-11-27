import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let mainWin: BrowserWindow | null = null;

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
  mainWin = win;
  // 24 nov: ecrã proporcional — tudo escala com o tamanho da janela (13"/14" reduz, ecrãs grandes aumentam).
  const fit = () => {
    if (win.isDestroyed()) return;
    const [w = 1440, h = 880] = win.getContentSize();
    const z = Math.max(0.72, Math.min(1.4, Math.min(w / 1440, h / 880)));
    win.webContents.setZoomFactor(Math.round(z * 100) / 100);
  };
  win.on("resize", fit);
  win.webContents.on("did-finish-load", fit);
  // A barra da chamada em curso só aparece quando o CRM não está à frente.
  win.on("focus", () => refreshCallBar());
  win.on("blur", () => refreshCallBar());
  win.on("minimize", () => refreshCallBar());
  win.on("restore", () => refreshCallBar());
}

// ───────────── Caixas por cima de tudo (26 nov) ─────────────
type OverlayData = { title?: string; subtitle?: string; lines?: string[]; tone?: "green" | "orange" | "dark"; since?: number;
  buttons?: { id: string; label: string; kind?: "primary" | "danger" | "plain" }[] };
const overlays = new Map<string, BrowserWindow>();
const overlayData = new Map<string, OverlayData>();
const SIZES: Record<string, [number, number]> = { incoming: [360, 190], call: [400, 96], help: [380, 210] };
const posFile = () => join(app.getPath("userData"), "overlay-positions.json");
function loadPos(): Record<string, [number, number]> { try { return JSON.parse(readFileSync(posFile(), "utf8")); } catch { return {}; } }
function savePos(kind: string, x: number, y: number) { const p = loadPos(); p[kind] = [x, y]; try { writeFileSync(posFile(), JSON.stringify(p)); } catch { /* sem disco */ } }
const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

function overlayHtml(kind: string, d: OverlayData) {
  const color = d.tone === "green" ? "#15803D" : d.tone === "orange" ? "#C2410C" : "#141414";
  const dark = d.tone === "dark";
  const btns = (d.buttons ?? []).map((b) => `<button data-a="${esc(b.id)}" class="${b.kind ?? "plain"}">${esc(b.label)}</button>`).join("");
  const timer = d.since ? `<span id="t"></span>` : "";
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><title>BASECOM</title><style>
    html,body{margin:0;height:100%;font-family:-apple-system,"Segoe UI",sans-serif;-webkit-app-region:drag;user-select:none;overflow:hidden}
    body{box-sizing:border-box;border:2px solid ${color};border-radius:14px;background:${dark ? "#141414" : "#FFFFFF"};color:${dark ? "#FFFFFF" : "#141414"};padding:${kind === "call" ? "10px 12px" : "14px 16px"};display:flex;flex-direction:${kind === "call" ? "row" : "column"};gap:${kind === "call" ? "10px" : "8px"};align-items:${kind === "call" ? "center" : "stretch"}}
    .k{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${dark ? "#A3A3A3" : color}}
    b{font-size:${kind === "call" ? "14px" : "17px"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .l{font-size:12px;color:${dark ? "#D4D4D4" : "#55534E"}}
    .row{display:flex;gap:8px}.col{display:flex;flex-direction:column;min-width:0;flex:1}
    button{-webkit-app-region:no-drag;height:40px;border-radius:10px;font:600 13px inherit;cursor:pointer;padding:0 12px;border:1px solid ${dark ? "#3F3F3F" : "#D6D3CC"};background:${dark ? "#262626" : "#FFFFFF"};color:inherit;flex:1}
    .primary{background:${color};border-color:${color};color:#FFFFFF}.danger{background:#D70015;border-color:#D70015;color:#FFFFFF}
  </style></head><body>
    <div class="col"><span class="k">${esc(d.subtitle ?? "")}</span><b>${esc(d.title ?? "")}</b>${(d.lines ?? []).map((l) => `<span class="l">${esc(l)}</span>`).join("")}${timer}</div>
    <div class="row">${btns}</div>
    <script>
      document.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => window.basecom.overlayAct(b.dataset.a)));
      ${d.since ? `const s=${d.since};const t=document.getElementById("t");t.className="l";const f=()=>{const x=Math.max(0,Math.floor((Date.now()-s)/1000));t.textContent=Math.floor(x/60)+":"+String(x%60).padStart(2,"0")};f();setInterval(f,1000);` : ""}
    </script></body></html>`;
}

function openOverlay(kind: string, d: OverlayData) {
  overlayData.set(kind, d);
  // 27 nov: com o CRM à frente usa-se a caixa do próprio CRM (nunca duas caixas); a de cima de tudo só com o CRM atrás ou minimizado.
  if ((kind === "call" || kind === "incoming") && mainWin && mainWin.isFocused() && !mainWin.isMinimized() && mainWin.isVisible()) { closeOverlay(kind, false); return; }
  const [w, h] = SIZES[kind] ?? [380, 200];
  let win = overlays.get(kind);
  if (!win || win.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    const saved = loadPos()[kind];
    const offset = kind === "help" ? 230 : kind === "call" ? 460 : 0;
    const [x, y] = saved ?? [area.x + area.width - w - 24, area.y + 24 + offset];
    win = new BrowserWindow({ width: w, height: h, x, y, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      alwaysOnTop: true, show: false, transparent: false, backgroundColor: "#FFFFFF",
      webPreferences: { preload: join(__dirname, "../preload/index.cjs"), contextIsolation: true, sandbox: true } });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on("moved", () => { const [nx, ny] = win!.getPosition(); savePos(kind, nx!, ny!); });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    overlays.set(kind, win);
    win.once("ready-to-show", () => win!.showInactive());
  }
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml(kind, d))}`);
  if (win.isVisible() === false) win.showInactive();
}
function closeOverlay(kind: string, forget = true) {
  if (forget) overlayData.delete(kind);
  const win = overlays.get(kind);
  if (win && !win.isDestroyed()) win.close();
  overlays.delete(kind);
}
function refreshCallBar() { for (const k of ["call", "incoming"]) { const d = overlayData.get(k); if (d) openOverlay(k, d); } }

ipcMain.on("overlay-show", (_e, kind: string, data: OverlayData) => { if (typeof kind === "string" && SIZES[kind]) openOverlay(kind, data ?? {}); });
ipcMain.on("overlay-hide", (_e, kind: string) => closeOverlay(kind));
ipcMain.on("overlay-act", (e, action: string) => {
  const kind = [...overlays.entries()].find(([, w]) => !w.isDestroyed() && w.webContents.id === e.sender.id)?.[0];
  if (!kind || !mainWin || mainWin.isDestroyed()) return;
  if (action === "crm" || action === "script" || action === "answer" || action === "open") { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  mainWin.webContents.send("overlay-action", kind, action);
});

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
