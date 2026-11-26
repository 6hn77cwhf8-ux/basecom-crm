import { contextBridge, ipcRenderer } from "electron";

// Ponte segura entre a janela e o sistema. Só o que for explicitamente exposto aqui fica acessível.
contextBridge.exposeInMainWorld("basecom", {
  version: ipcRenderer.sendSync("shell-version") as string,
  /**
   * 26 nov: caixas por cima de todas as aplicações (chamada a entrar, chamada em curso, pedido de ajuda).
   * O CRM mostra/esconde; os botões da caixa voltam ao CRM como ações.
   */
  overlay: {
    show: (kind: string, data: unknown) => ipcRenderer.send("overlay-show", kind, data),
    hide: (kind: string) => ipcRenderer.send("overlay-hide", kind),
    onAction: (cb: (kind: string, action: string) => void) => {
      const h = (_e: unknown, kind: string, action: string) => cb(kind, action);
      ipcRenderer.on("overlay-action", h);
      return () => { ipcRenderer.removeListener("overlay-action", h); };
    },
  },
  /** Usado só dentro das próprias caixas: carregar num botão. */
  overlayAct: (action: string) => ipcRenderer.send("overlay-act", action),
});
