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
import { Opportunities } from "./pages/Opportunities";
import { Carteira } from "./pages/Carteira";
import { applyTheme } from "./theme";

const PHASE: Partial<Record<PageId, string>> = {
  painel: "Arranque B", atuais: "Fase 3",
  pendencias: "Arranque B", tickets: "Arranque B", vendas: "Arranque B", objetivos: "Arranque B", relatorios: "Arranque B",
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(api.hasToken());
  const [page, setPage] = useState<PageId>("novos");
  const [importing, setImporting] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    if (!api.hasToken()) return;
    api.me().then((u) => { setUser(u); if (u?.theme) applyTheme(u.theme); }).catch(() => undefined).finally(() => setChecking(false));
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
  if (!user) return <Login onDone={(u) => { setUser(u); if (u.theme) applyTheme(u.theme); setPage("novos"); }} />;
  if (user.mustChangePassword) return <ChangePassword onLogout={logout} onDone={() => setUser({ ...user, mustChangePassword: false })} />;

  const label = NAV.find((n) => n.id === page)?.label ?? "";
  return (
    <Shell user={user} onUser={setUser} page={page} onNavigate={(p) => { setPage(p); setImporting(false); }} onLogout={logout} onOpenCompany={setCompanyId}>
      {page === "empresas" ? (importing && user.role === "admin"
        ? <ImportWizard onBack={() => setImporting(false)} />
        : <Companies me={user} onOpen={setCompanyId} onImport={() => setImporting(true)} />)
        : page === "novos" ? null
        : page === "agenda" ? <Agenda me={user} onOpenCompany={setCompanyId} />
        : page === "carteira" ? <Carteira me={user} onOpenCompany={setCompanyId} />
        : page === "oportunidades" ? <Opportunities me={user} onOpenCompany={setCompanyId} />
        : page === "equipa" ? <Team me={user} /> : page === "config" ? <Settings /> : <Placeholder title={label} phase={PHASE[page] ?? "Fase seguinte"} />}
      {/* O Ligar fica sempre montado: ao mudar de página a chamada continua e aparece o cartão flutuante. */}
      <div style={{ display: page === "novos" ? "contents" : "none" }}>
        <PowerDialer me={user} onOpenCompany={setCompanyId} active={page === "novos"} onShow={() => { setPage("novos"); setImporting(false); }} />
      </div>
      {companyId && <CompanyDrawer id={companyId} me={user} onClose={() => setCompanyId(null)} />}
    </Shell>
  );
}
