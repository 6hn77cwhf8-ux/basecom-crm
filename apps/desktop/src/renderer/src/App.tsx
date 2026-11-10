// Ecrã provisório. O ecrã de entrada (email, palavra-passe e 2FA) é o próximo passo da fase 1.
export function App() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F5F5F7", fontFamily: "Manrope, -apple-system, 'Segoe UI', sans-serif", color: "#0B0B0B" }}>
      <section style={{ background: "#FFFFFF", border: "1px solid #E5E5EA", borderRadius: 14, padding: "32px 40px", textAlign: "center" }}>
        <div style={{ width: 40, height: 4, background: "#FF5A00", borderRadius: 2, margin: "0 auto 16px" }} />
        <h1 style={{ margin: 0, fontSize: 28 }}>BASECOM CRM</h1>
        <p style={{ color: "#6E6E73" }}>Em construção · fase 1</p>
      </section>
    </main>
  );
}
