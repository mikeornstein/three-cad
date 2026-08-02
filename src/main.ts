import "./styles.css";
import { createDemoSolid } from "./demo/createDemoSolid";
import { displayModeLabel, Viewport } from "./viewport/Viewport";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
  if (!canvas) {
    throw new Error("Missing #viewport canvas");
  }

  const viewport = new Viewport(canvas);
  const modeButton = document.querySelector<HTMLButtonElement>("#display-mode");

  const syncModeButton = (): void => {
    if (!modeButton) return;
    const mode = viewport.getDisplayMode();
    modeButton.textContent = displayModeLabel(mode);
    modeButton.setAttribute("aria-label", `Display mode: ${displayModeLabel(mode)}. Click to cycle.`);
    modeButton.dataset.mode = mode;
  };

  modeButton?.addEventListener("click", () => {
    viewport.cycleDisplayMode();
    syncModeButton();
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (event.key === "m" || event.key === "M") {
      viewport.cycleDisplayMode();
      syncModeButton();
    }
  });

  syncModeButton();

  try {
    const solid = await createDemoSolid();
    viewport.setContent(solid);
  } catch (err) {
    console.error("Failed to build demo solid", err);
  }
}

void main();
