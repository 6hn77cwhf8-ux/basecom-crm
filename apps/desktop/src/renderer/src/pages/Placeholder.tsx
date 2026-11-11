import { c, card, PageHeader } from "../ui";

/** Ecrãs ainda por construir: diz em que fase chegam, sem dados fictícios. */
export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader eyebrow={phase} title={title} />
      <section style={{ ...card, padding: "48px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
        <span style={{ width: 48, height: 48, borderRadius: 14, background: c.brandSoft, display: "grid", placeItems: "center" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: "none", stroke: c.ink, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
          </svg>
        </span>
        <h2 style={{ margin: 0, fontSize: 16, lineHeight: "22px", fontWeight: 600 }}>Em construção</h2>
        <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: "20px", color: c.muted }}>
          Este ecrã chega {phase.startsWith("Fase") ? "na" : "no"} {phase}, tal como nas maquetas aprovadas.
        </p>
      </section>
    </>
  );
}
