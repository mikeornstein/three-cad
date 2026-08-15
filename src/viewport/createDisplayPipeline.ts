/**
 * Game-engine display path: scene pass at a budgeted scale + TAAU reconstruct.
 * MSAA must stay off on the renderer (TAAU requirement).
 */

import type { Camera, Scene } from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { mrt, output, pass, velocity } from "three/tsl";
import { taau } from "three/addons/tsl/display/TAAUNode.js";

export interface DisplayPipeline {
  readonly pipeline: RenderPipeline;
  readonly scenePass: ReturnType<typeof pass>;
  readonly taau: ReturnType<typeof taau>;
  setScale(scale: number): void;
  /** Drop history so a live-sphere move does not ghost. */
  resetHistory(): void;
  render(): void;
  dispose(): void;
}

export function createDisplayPipeline(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
): DisplayPipeline {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(
    mrt({
      output,
      velocity,
    }),
  );
  scenePass.setResolutionScale(1);

  const taauNode = taau(
    scenePass.getTextureNode("output"),
    scenePass.getTextureNode("depth"),
    scenePass.getTextureNode("velocity"),
    camera,
  );

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = taauNode;

  let applied = 1;

  return {
    pipeline,
    scenePass,
    taau: taauNode,
    setScale(scale: number) {
      const s = Math.min(1, Math.max(0.45, scale));
      if (Math.abs(s - applied) < 0.02) return;
      applied = s;
      scenePass.setResolutionScale(s);
    },
    resetHistory() {
      // TAAU reseeds when the history target size changes. No public reset API.
      const history = (
        taauNode as unknown as {
          _historyRenderTarget: { setSize: (w: number, h: number) => void };
        }
      )._historyRenderTarget;
      history.setSize(1, 1);
    },
    render() {
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      scenePass.dispose();
    },
  };
}
