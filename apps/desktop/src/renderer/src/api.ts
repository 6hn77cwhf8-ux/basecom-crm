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
export type CompanyRow = {
  id: string; nif: string; name: string; accountType: "client" | "prospect"; municipality: string | null; locality: string | null; district: string | null; sector: string | null;
  ownerId: string | null; owner: string | null; walletKind: "NC" | "FC"; doNotContact: boolean; needsReview: string | null;
  nifValid: boolean; operator: string | null; loyaltyEnd: string | null;
};
export type CompanyKpis = { total: number; noOwner: number; withOwner: number; nc: number; fc: number; clients: number; dnc: number; review: number };
export type CompanyFilters = Partial<{ q: string; accountType: string; owner: string; wallet: string; status: string; municipality: string; district: string; sector: string; offset: number; limit: number }>;
export type FilterOptions = { municipalities: string[]; districts: string[]; sectors: string[] };
export type Contact = { id: string; kind: "phone" | "email" | "person"; value: string; phoneType: string | null; personName: string | null; salutation: string | null; isPrimary: boolean; status: string };
export type Note = { id: string; kind: string; text: string; at: string; user: string | null; batchId: string | null };
export type CompanyDetail = {
  company: CompanyRow & { size: string | null; employeesBand: string | null; l2bMonthly: string | null; address: string | null; postalCode: string | null; economicGroup: string | null; lastSourceYear: number | null; sources: string | null; createdAt: string; updatedAt: string;
    annualRevenue: string | null; locationsPotential: string | null; rgu: Record<string, number> | null; product: string | null; technology: string | null;
    loyaltyMonths: number | null; portalStatus: string | null; nosExitMonth: string | null; nboCampaign: string | null };
  contacts: Contact[]; notes: Note[];
  wallet: { id: string; kind: string; status: string; effectiveFrom: string; reason: string | null; toOwner: string | null; createdAt: string }[];
};
export type ScheduledChange = { id: string; companyId: string; company: string; nif: string; kind: string; effectiveFrom: string; reason: string | null; toOwnerId: string | null; toOwner: string | null; createdAt: string };
export type SearchHit = { id: string; nif: string; name: string; municipality: string | null; owner: string | null; accountType: string };
export type SheetAction = "import" | "review" | "skip";
export type SheetAnalysis = { name: string; rows: number; headers: string[]; unknownColumns: string[]; action: SheetAction; validNif: number; invalidNif: number; emptyNif: number; phones: number; badPhones: number; noContact: number };
export type Upload = { id: string; number: number; fileName: string; sheets: SheetAnalysis[]; fields: Record<string, string>; mapping: Record<string, string>; trialSize: number };
export type PreviewSummary = { total: number; byResult: Record<string, number>; clients: number; prospects: number; withOwner: number };
export type ImportRow = { id: string; sheet: string; rowNumber: number; nif: string | null; name: string | null; result: string; detail: string | null; accountType: string | null; owner: string | null };
export type Batch = { id: string; number: number; kind: string; fileName: string; status: string; summary: { preview?: PreviewSummary; committed?: { created: number; updated: number } }; createdAt: string; committedAt: string | null; revertedAt: string | null; createdBy: string | null };

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
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

  companies: (f: CompanyFilters) => call<{ total: number; rows: CompanyRow[] }>(`/companies${qs(f)}`),
  companyKpis: () => call<CompanyKpis>("/companies/kpis"),
  filterOptions: () => call<FilterOptions>("/companies/options"),
  company: (id: string) => call<CompanyDetail>(`/companies/${id}`),
  search: (q: string) => call<{ results: SearchHit[] }>(`/search${qs({ q })}`).then((r) => r.results),

  transfer: (b: { companyIds: string[]; toOwnerId: string | null; when: "current" | "next"; reason: string }) =>
    call<{ scheduled: number; effectiveFrom: string; cycle: string; applied: number }>("/companies/transfer", { method: "POST", body: JSON.stringify(b) }),
  scheduledTransfers: () => call<{ changes: ScheduledChange[] }>("/wallet/scheduled").then((r) => r.changes),
  cancelTransfer: (id: string) => call(`/wallet/scheduled/${id}/cancel`, { method: "POST", body: "{}" }),
  setWalletKind: (id: string, kind: "NC" | "FC", reason: string) => call(`/companies/${id}/wallet-kind`, { method: "POST", body: JSON.stringify({ kind, reason }) }),
  setDoNotContact: (id: string, value: boolean, reason: string) => call(`/companies/${id}/do-not-contact`, { method: "POST", body: JSON.stringify({ value, reason }) }),
  setContactStatus: (id: string, status: "valid" | "incorrect") => call(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  imports: () => call<{ batches: Batch[] }>("/imports").then((r) => r.batches),
  uploadBase: (file: File) => file.arrayBuffer().then((buf) => call<Upload>("/imports/base", { method: "POST", body: buf, headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) } })),
  previewImport: (id: string, body: { sheets: Record<string, SheetAction>; mapping: Record<string, string>; limit: number | null }) =>
    call<{ id: string; number: number; summary: PreviewSummary }>(`/imports/${id}/preview`, { method: "POST", body: JSON.stringify(body) }),
  importRows: (id: string, q: { result?: string; search?: string; offset?: number; limit?: number }) => call<{ total: number; rows: ImportRow[] }>(`/imports/${id}/rows${qs(q)}`),
  commitImport: (id: string, code: string) => call<{ number: number; created: number; updated: number }>(`/imports/${id}/commit`, { method: "POST", body: JSON.stringify({ code }) }),
  revertImport: (id: string, code: string) => call<{ number: number }>(`/imports/${id}/revert`, { method: "POST", body: JSON.stringify({ code }) }),
  discardImport: (id: string) => call(`/imports/${id}/discard`, { method: "POST", body: "{}" }),
};
