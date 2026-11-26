/** Caixas por cima de todas as aplicações (26 nov): só existem no programa do computador a partir da versão 0.16. */
type OverlayApi = { show: (kind: string, data: unknown) => void; hide: (kind: string) => void; onAction: (cb: (kind: string, action: string) => void) => () => void };
export const overlay: OverlayApi | null = (window as unknown as { basecom?: { overlay?: OverlayApi } }).basecom?.overlay ?? null;
