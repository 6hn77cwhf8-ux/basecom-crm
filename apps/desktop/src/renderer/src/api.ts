/** Endereço do servidor: local em desenvolvimento, crm.basecom.pt em produção. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type Role = "admin" | "team_lead" | "sales";
export type User = { id: string; name: string; email: string; role: Role; mustChangePassword: boolean };
export type TeamMember = { id: string; name: string; email: string; role: Role; active: boolean; hiredAt: string | null; totpEnabled: boolean; mustChangePassword: boolean; locked: boolean };
export type AuditEntry = { id: string; action: string; userName: string; targetName: string | null; details: string | null; at: string };
export type Settings = {
  auth: { maxFailedLogins: number; lockMinutes: number; sessionHours: number };
  timeLimits: { resultSeconds: number; nextCallSeconds: number; campaignSwitchMinutes: number; trainingMinutes: number; breakMinutes: number };
};
export const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", team_lead: "Chefe de Equipa", sales: "Comercial" };
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
  changePassword: (current: string, next: string) => call("/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }),
  users: () => call<{ users: TeamMember[] }>("/users").then((r) => r.users),
  createUser: (u: { name: string; email: string; role: Role; hiredAt: string | null }) => call<{ id: string; tempPassword: string }>("/users", { method: "POST", body: JSON.stringify(u) }),
  updateUser: (id: string, patch: Partial<{ name: string; role: Role; active: boolean; hiredAt: string | null }>) => call(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  resetPassword: (id: string) => call<{ tempPassword: string }>(`/users/${id}/reset-password`, { method: "POST", body: "{}" }),
  resetTotp: (id: string) => call(`/users/${id}/reset-2fa`, { method: "POST", body: "{}" }),
  settings: () => call<{ settings: Settings }>("/settings").then((r) => r.settings),
  saveSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => call(`/settings/${key}`, { method: "PUT", body: JSON.stringify(value) }),
  audit: () => call<{ entries: AuditEntry[] }>("/audit").then((r) => r.entries),
};
