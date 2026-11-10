/** Endereço do servidor: local em desenvolvimento, crm.basecom.pt em produção. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type User = { id: string; name: string; email: string; role: "admin" | "team_lead" | "sales" };
export type LoginStep =
  | { step: "totp"; challengeToken: string }
  | { step: "enroll"; challengeToken: string; qrDataUrl: string; secret: string };

let token: string | null = sessionStorage.getItem("basecom_token");

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw new Error("Sem ligação ao servidor. Verifique a internet.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Ocorreu um erro. Tente novamente.");
  return body as T;
}

export const api = {
  login: (email: string, password: string) => call<LoginStep>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  confirmCode: async (challengeToken: string, code: string) => {
    const r = await call<{ token: string; user: User }>("/auth/totp", { method: "POST", body: JSON.stringify({ challengeToken, code, device: navigator.userAgent.slice(0, 120) }) });
    token = r.token;
    sessionStorage.setItem("basecom_token", r.token);
    return r.user;
  },
  me: () => call<{ user: User }>("/auth/me").then((r) => r.user),
  logout: async () => {
    await call("/auth/logout", { method: "POST" }).catch(() => undefined);
    token = null;
    sessionStorage.removeItem("basecom_token");
  },
  hasToken: () => token !== null,
};
