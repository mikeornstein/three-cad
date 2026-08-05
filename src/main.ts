import "./styles.css";
import { demoPartDef } from "./document/demoDocument";
import { createDemoSolid } from "./demo/createDemoSolid";
import { DEFAULT_LIBRARY_ENTRY } from "./render/library";
import { BuildTreePanel } from "./ui/BuildTreePanel";
import { OnscreenConsole } from "./ui/OnscreenConsole";
import { Viewport } from "./viewport/Viewport";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
  if (!canvas) {
    throw new Error("Missing #viewport canvas");
  }

  const consoleRoot = document.querySelector<HTMLElement>("#console");
  const screenConsole = consoleRoot
    ? new OnscreenConsole(consoleRoot)
    : null;

  const buildTreeRoot = document.querySelector<HTMLElement>("#build-tree");
  const buildTree = buildTreeRoot
    ? new BuildTreePanel(buildTreeRoot, {
        onActivate: (_node, summary) => {
          screenConsole?.log(`build tree: ${summary}`);
        },
      })
    : null;
  buildTree?.setPart(demoPartDef());

  if (typeof navigator === "undefined" || !navigator.gpu) {
    const msg =
      "WebGPU is required for three-cad display. Use Chrome, Edge, Firefox, or Safari 26+ with WebGPU enabled.";
    screenConsole?.log(`error: ${msg}`);
    throw new Error(msg);
  }

  const viewport = new Viewport(canvas);
  try {
    await viewport.init();
  } catch (err) {
    console.error("WebGPU init failed", err);
    screenConsole?.log(`error: WebGPU init failed — ${String(err)}`);
    throw err;
  }

  screenConsole?.log(
    "kernel: SDF field solid · display: WebGPU sphere-trace (WGSL, no mesh)",
  );
  screenConsole?.log(
    "eval: document PartDef → definitionHash cache → field; mesh export-only",
  );
  screenConsole?.log(
    "build tree (left): construction ops · click row to copy summary",
  );

  try {
    const solid = createDemoSolid();
    // Keep scene look in sync with the library entry used by the field mesh.
    viewport.applyLook(DEFAULT_LIBRARY_ENTRY.look);
    screenConsole?.log(
      `look-dev: «${DEFAULT_LIBRARY_ENTRY.id}» — ${DEFAULT_LIBRARY_ENTRY.label}`,
    );
    viewport.setContent(solid);
    const hash = solid.userData.definitionHash as string | undefined;
    if (hash) {
      screenConsole?.log(`demo part hash: ${hash}`);
    }
  } catch (err) {
    console.error("Failed to build demo solid", err);
    screenConsole?.log(`error: failed to build demo solid — ${String(err)}`);
  }
}

main().catch((err) => {
  console.error(err);
});
