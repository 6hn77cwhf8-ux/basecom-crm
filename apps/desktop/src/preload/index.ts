import { contextBridge, ipcRenderer } from "electron";

// Ponte segura entre a janela e o sistema. Só o que for explicitamente exposto aqui fica acessível.
contextBridge.exposeInMainWorld("basecom", { version: ipcRenderer.sendSync("shell-version") as string });
