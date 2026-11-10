import { useEffect, useState } from "react";
import { api, type User } from "./api";
import { Login } from "./Login";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(api.hasToken());

  useEffect(() => {
    if (!api.hasToken()) return;
    api.me().then(setUser).catch(() => undefined).finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (!user) return <Login onDone={setUser} />;

  // Ecrã provisório até ao menu lateral e ao Painel (passos seguintes da fase 1).
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F5F5F7", fontFamily: "Manrope, -apple-system, 'Segoe UI', sans-serif" }}>
      <section style={{ background: "#FFFFFF", border: "1px solid #E5E5EA", borderRadius: 14, padding: "32px 40px", textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 26 }}>Olá, {user.name}</h1>
        <p style={{ margin: 0, color: "#6E6E73" }}>Entrou com verificação em dois passos.</p>
        <button onClick={() => api.logout().then(() => setUser(null))} style={{ fontFamily: "inherit", height: 40, borderRadius: 10, border: "1px solid #E5E5EA", background: "#FFFFFF", cursor: "pointer", fontWeight: 600 }}>Sair</button>
      </section>
    </main>
  );
}
