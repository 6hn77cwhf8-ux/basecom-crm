import { useEffect, useState } from "react";
import { api, type User } from "./api";
import { Login } from "./Login";
import { ChangePassword } from "./ChangePassword";
import { NAV, Shell, type PageId } from "./Shell";
import { Team } from "./pages/Team";
import { Settings } from "./pages/Settings";
import { Placeholder } from "./pages/Placeholder";

const PHASE: Partial<Record<PageId, string>> = {
  painel: "Arranque B", empresas: "Fase 2", agenda: "Fase 3", novos: "Fase 3", atuais: "Fase 3", carteira: "Fase 3", oportunidades: "Fase 3",
  pendencias: "Arranque B", tickets: "Arranque B", vendas: "Arranque B", objetivos: "Arranque B", relatorios: "Arranque B",
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(api.hasToken());
  const [page, setPage] = useState<PageId>("equipa");

  useEffect(() => {
    if (!api.hasToken()) return;
    api.me().then(setUser).catch(() => undefined).finally(() => setChecking(false));
  }, []);

  const logout = () => api.logout().then(() => setUser(null));
  if (checking) return null;
  if (!user) return <Login onDone={(u) => { setUser(u); setPage(u.role === "sales" ? "painel" : "equipa"); }} />;
  if (user.mustChangePassword) return <ChangePassword onLogout={logout} onDone={() => setUser({ ...user, mustChangePassword: false })} />;

  const label = NAV.find((n) => n.id === page)?.label ?? "";
  return (
    <Shell user={user} page={page} onNavigate={setPage} onLogout={logout}>
      {page === "equipa" ? <Team me={user} /> : page === "config" ? <Settings /> : <Placeholder title={label} phase={PHASE[page] ?? "Fase seguinte"} />}
    </Shell>
  );
}
