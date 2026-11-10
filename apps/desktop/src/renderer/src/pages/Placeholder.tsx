import { c, card, PageHeader } from "../ui";

export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader eyebrow={phase} title={title} />
      <section style={{ ...card, padding: 32, textAlign: "center", color: c.muted }}>Em construção. Este ecrã chega na {phase.toLowerCase()}, como nas maquetas aprovadas.</section>
    </>
  );
}
