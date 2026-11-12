import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// ⌘Z / Ctrl+Z só anulam texto dentro de campos (o menu não os trata; durante as chamadas o Power Dialer bloqueia-os).
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || !["z", "y"].includes(e.key.toLowerCase())) return;
  const t = e.target as HTMLElement;
  if (!(t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  e.preventDefault();
  document.execCommand(e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
});

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
