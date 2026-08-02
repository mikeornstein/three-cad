import "./styles.css";
import { createDemoSolid } from "./demo/createDemoSolid";
import { Viewport } from "./viewport/Viewport";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
  if (!canvas) {
    throw new Error("Missing #viewport canvas");
  }

  const viewport = new Viewport(canvas);

  try {
    const solid = await createDemoSolid();
    viewport.setContent(solid);
  } catch (err) {
    console.error("Failed to build demo solid", err);
    const hint = document.querySelector("#hint");
    if (hint) {
      hint.textContent = "Failed to load demo solid — see console";
    }
  }
}

void main();
