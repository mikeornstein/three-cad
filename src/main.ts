import "./styles.css";
import { demoPartDef } from "./document/demoDocument";
import { createDemoSolid } from "./demo/createDemoSolid";
import { SphereCursorFollow } from "./demo/sphereCursorFollow";
import type { LiveSphereHandle } from "./render/createFieldRayMarchMesh";
import { DEFAULT_LIBRARY_ENTRY } from "./render/library";
import { loadStudioEnvironment } from "./render/studioEnv";
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

  const look = DEFAULT_LIBRARY_ENTRY.look;
  viewport.applyLook(look);

  let envMap = null as Awaited<
    ReturnType<typeof loadStudioEnvironment>
  > | null;
  try {
    envMap = await loadStudioEnvironment(viewport.renderer);
    viewport.setStudioEnvironment(envMap);
    // Sync look key/fill with HDR probes for the field mesh uniforms.
    look; // look is const from library; probes applied via env on mesh
    screenConsole?.log(
      `env: HDRI «${envMap.id}» (Z-up rotated, bg blur ${look.backgroundBlurriness}) · IBL ${look.envIntensity}`,
    );
  } catch (err) {
    console.warn("Studio HDRI failed — continuing without IBL", err);
    screenConsole?.log(
      `warn: studio HDRI failed — ${String(err)} (using look fallback lights)`,
    );
  }

  try {
    const solid = createDemoSolid({
      envMap: envMap?.equirect ?? null,
      envIntensity: look.envIntensity,
      look: {
        ...look,
        // When HDR loaded, push extracted probe colors into look-shaped dirs
        // so mesh uniforms match the scene lights.
        ...(envMap
          ? {
              keyDir: [
                envMap.keyDir.x,
                envMap.keyDir.y,
                envMap.keyDir.z,
              ] as const,
              keyColor: [
                envMap.keyColor.x,
                envMap.keyColor.y,
                envMap.keyColor.z,
              ] as const,
              fillDir: [
                envMap.fillDir.x,
                envMap.fillDir.y,
                envMap.fillDir.z,
              ] as const,
              fillColor: [
                envMap.fillColor.x,
                envMap.fillColor.y,
                envMap.fillColor.z,
              ] as const,
            }
          : {}),
      },
    });
    screenConsole?.log(
      `look-dev: «${DEFAULT_LIBRARY_ENTRY.id}» — ${DEFAULT_LIBRARY_ENTRY.label}`,
    );
    viewport.setContent(solid);
    const hash = solid.userData.definitionHash as string | undefined;
    if (hash) {
      screenConsole?.log(`demo part hash: ${hash}`);
    }

    const liveSphere = solid.userData.liveSphere as LiveSphereHandle | undefined;
    if (liveSphere) {
      new SphereCursorFollow({
        viewport,
        liveSphere,
        canvas,
        log: (msg) => screenConsole?.log(msg),
      });
    }
  } catch (err) {
    console.error("Failed to build demo solid", err);
    screenConsole?.log(`error: failed to build demo solid — ${String(err)}`);
  }
}

main().catch((err) => {
  console.error(err);
});
