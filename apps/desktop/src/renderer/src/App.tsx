import { useEffect, useState } from "react";
import { api, type User } from "./api";
import { Login } from "./Login";
import { ChangePassword } from "./ChangePassword";
import { NAV, Shell, type PageId } from "./Shell";
import { Team } from "./pages/Team";
import { Settings } from "./pages/Settings";
import { Placeholder } from "./pages/Placeholder";
import { Companies } from "./pages/Companies";
import { CompanyDrawer } from "./pages/CompanyDrawer";
import { ImportWizard } from "./pages/ImportWizard";
import { PowerDialer } from "./pages/PowerDialer";
import { Agenda } from "./pages/Agenda";

const PHASE: Partial<Record<PageId, string>> = {
  painel: "Arranque B", atuais: "Fase 3", carteira: "Fase 3", oportunidades: "Fase 3",
  pendencias: "Arranque B", tickets: "Arranque B", vendas: "Arranque B", objetivos: "Arranque B", relatorios: "Arranque B",
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(api.hasToken());
  const [page, setPage] = useState<PageId>("empresas");
  const [importing, setImporting] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    if (!api.hasToken()) return;
    api.me().then(setUser).catch(() => undefined).finally(() => setChecking(false));
  }, []);

  const logout = () => api.logout().then(() => setUser(null));
  // Sinal de vida a cada minuto: regista a entrada e mantém o ponto certo; se a aplicação fechar, o período termina no último sinal.
  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    api.heartbeat().catch(() => undefined);
    const t = setInterval(() => api.heartbeat().catch(() => undefined), 60_000);
    return () => clearInterval(t);
  }, [user?.id, user?.mustChangePassword]);
  if (checking) return null;
  if (!user) return <Login onDone={(u) => { setUser(u); setPage("empresas"); }} />;
  if (user.mustChangePassword) return <ChangePassword onLogout={logout} onDone={() => setUser({ ...user, mustChangePassword: false })} />;

  const label = NAV.find((n) => n.id === page)?.label ?? "";
  return (
    <Shell user={user} page={page} onNavigate={(p) => { setPage(p); setImporting(false); }} onLogout={logout} onOpenCompany={setCompanyId}>
      {page === "empresas" ? (importing && user.role === "admin"
        ? <ImportWizard onBack={() => setImporting(false)} />
        : <Companies me={user} onOpen={setCompanyId} onImport={() => setImporting(true)} />)
        : page === "novos" ? <PowerDialer me={user} onOpenCompany={setCompanyId} />
        : page === "agenda" ? <Agenda me={user} onOpenCompany={setCompanyId} />
        : page === "equipa" ? <Team me={user} /> : page === "config" ? <Settings /> : <Placeholder title={label} phase={PHASE[page] ?? "Fase seguinte"} />}
      {companyId && <CompanyDrawer id={companyId} me={user} onClose={() => setCompanyId(null)} />}
    </Shell>
  );
}
