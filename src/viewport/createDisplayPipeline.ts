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
  /**
   * When false, present the unjittered scene pass (live-sphere / field deform).
   * When true, TAAU + Halton view-offset (camera motion of a static field).
   */
  setTemporal(enabled: boolean): void;
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
  let temporal = true;

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
    setTemporal(enabled: boolean) {
      if (enabled === temporal) return;
      temporal = enabled;
      // Unjittered pass while the field deforms — TAAU view-offset + stale
      // history reads as zoom/pop. Re-enable after motion; needsUpdate so
      // the next render rebuilds the quad without leftover viewOffset hooks.
      pipeline.outputNode = enabled ? taauNode : scenePass.getTextureNode("output");
      pipeline.needsUpdate = true;
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
