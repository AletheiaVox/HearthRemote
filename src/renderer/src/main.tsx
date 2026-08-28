import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

declare const __HEARTH_WEB__: boolean;

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root.");

if (typeof __HEARTH_WEB__ !== "undefined" && __HEARTH_WEB__) installVisualViewportSync();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (typeof __HEARTH_WEB__ !== "undefined" && __HEARTH_WEB__ && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}

function installVisualViewportSync(): void {
  let pendingFrame: number | undefined;
  const sync = (): void => {
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = undefined;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const style = document.documentElement.style;
      style.setProperty("--hearth-visual-width", `${width}px`);
      style.setProperty("--hearth-visual-height", `${height}px`);
      style.setProperty("--hearth-visual-left", `${left}px`);
      style.setProperty("--hearth-visual-top", `${top}px`);
    });
  };
  sync();
  window.addEventListener("resize", sync, { passive: true });
  window.visualViewport?.addEventListener("resize", sync, { passive: true });
  window.visualViewport?.addEventListener("scroll", sync, { passive: true });
}
