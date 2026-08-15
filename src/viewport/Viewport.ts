import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  GridHelper,
  Group,
  LineSegments,
  Mesh,
  type Object3D,
  type Texture,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  applyRayMarchQuality,
  isRayMarchMesh,
  LIVE_SPHERE_USER,
  type LiveSphereHandle,
} from "../render/createFieldRayMarchMesh";
import {
  DEFAULT_LOOK,
  type SceneLook,
} from "../render/looks";
import type { StudioEnvironment } from "../render/studioEnv";

/** World units are millimeters. Right-handed, Z-up. */
export const MM = 1;

export interface ViewportOptions {
  /**
   * Pre-created GPUDevice (from createWebGpuDevice). Required so Three.js
   * does not call requestAdapter({ featureLevel: "compatibility" }), which
   * fails on Safari and other browsers that omit that option.
   */
  readonly device: GPUDevice;
}

export class Viewport {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGPURenderer;
  readonly controls: OrbitControls;

  private readonly root = new Group();
  private readonly content = new Group();
  private animationId = 0;
  private disposed = false;
  private initialized = false;
  private look: SceneLook = DEFAULT_LOOK;
  private grid: GridHelper | null = null;
  private axes: AxesHelper | null = null;
  private studioEnv: StudioEnvironment | null = null;

  /** Bounding radius of current content (mm) — used for zoom LOD. */
  private contentRadiusMm = 80;
  /** Last applied pixel ratio (avoid thrashing setPixelRatio). */
  private appliedPixelRatio = 0;
  /** Last applied ray-march quality in [0, ~1.25] (1 = full interactive look-dev). */
  private appliedQuality = -1;
  /**
   * Extra resolution scale from FPS feedback (1 = full, lower = rescue frame time).
   * Multiplied with zoom-based quality; recovers slowly when FPS is healthy.
   */
  private fpsBudgetScale = 1;
  private fpsEma = 60;

  private idleMs = 0;
  private controlsActive = false;
  private readonly lastCamPos = new Vector3();
  private readonly lastTarget = new Vector3();
  private camSampled = false;
  /** True after resize / look / content / env until the next shaded frame. */
  private forceDirty = true;
  private holding = false;
  private lastLiveFingerprint = "";

  private readonly fpsEl: HTMLElement;
  private fpsFrames = 0;
  private fpsWindowStart = 0;
  /** Callbacks run each frame after controls/camera update, before render. */
  private readonly frameHooks = new Set<(dtMs: number) => void>();
  private lastFrameTime = 0;

  /** Wait after last camera / live-sphere motion before holding the frame. */
  private static readonly STILL_SETTLE_MS = 80;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: ViewportOptions,
  ) {
    this.scene.add(this.root);
    this.root.add(this.content);

    this.camera = new PerspectiveCamera(50, 1, 0.1 * MM, 100_000 * MM);
    this.camera.up.set(0, 0, 1);

    this.renderer = new WebGPURenderer({
      canvas,
      antialias: false,
      alpha: false,
      // Skip Three's hard-coded featureLevel: "compatibility" adapter path.
      device: options.device,
    });

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("start", this.onControlsStart);
    this.controls.addEventListener("end", this.onControlsEnd);

    this.fpsEl =
      document.getElementById("fps-meter") ?? ensureFpsElement(canvas);

    this.applyLook(DEFAULT_LOOK);
    this.onResize();
    window.addEventListener("resize", this.onResize);
  }

  private readonly onControlsStart = (): void => {
    this.controlsActive = true;
    this.idleMs = 0;
  };

  private readonly onControlsEnd = (): void => {
    this.controlsActive = false;
  };

  getSceneLook(): SceneLook {
    return this.look;
  }

  getStudioEnvironment(): StudioEnvironment | null {
    return this.studioEnv;
  }

  /**
   * Bind a real studio HDRI: scene background + environment PMREM, and
   * replace key/fill DirectionalLights with probes extracted from the map.
   */
  setStudioEnvironment(env: StudioEnvironment | null): void {
    if (this.studioEnv && this.studioEnv !== env) {
      // Caller owns dispose timing; do not auto-dispose shared env.
    }
    this.studioEnv = env;
    this.applyEnvironmentToScene();
    this.rebuildLights();
    this.invalidate();
  }

  applyLook(look: SceneLook): void {
    this.look = look;
    this.appliedPixelRatio = 0;
    this.applyPixelRatioForQuality(
      this.appliedQuality < 0 ? 1 : this.appliedQuality,
    );
    this.applyEnvironmentToScene();
    this.rebuildLights();
    this.rebuildScaleCues();
    this.invalidate();
  }

  /** Force the next frame to shade (resize, look, content, env). */
  invalidate(): void {
    this.forceDirty = true;
    this.holding = false;
    this.idleMs = 0;
  }

  private applyEnvironmentToScene(): void {
    const look = this.look;
    if (this.studioEnv) {
      const eq = this.studioEnv.equirect;
      eq.mapping = EquirectangularReflectionMapping;
      // Real HDRI: dim + heavy blur so the sky does not compete with the model.
      // Full-res equirect is still sampled in the field shader for sharp IBL.
      this.scene.background = eq;
      this.scene.backgroundIntensity = look.backgroundIntensity;
      this.scene.backgroundBlurriness = look.backgroundBlurriness;
      this.scene.environment = this.studioEnv.pmrem;
      this.scene.environmentIntensity = look.envIntensity;
      // HDR equirects are Y-up; three-cad is Z-up. Rx(+90°) maps HDR +Y (ceiling)
      // onto world +Z right-side up (Rx(−90°) left the studio inverted).
      this.scene.backgroundRotation.set(Math.PI / 2, 0, 0);
      this.scene.environmentRotation.set(Math.PI / 2, 0, 0);
    } else {
      this.scene.background = new Color(look.background);
      this.scene.backgroundIntensity = 1;
      this.scene.backgroundBlurriness = 0;
      this.scene.environment = null;
      this.scene.environmentIntensity = 1;
      this.scene.backgroundRotation.set(0, 0, 0);
      this.scene.environmentRotation.set(0, 0, 0);
      this.renderer.setClearColor(look.background, 1);
    }
  }

  private rebuildLights(): void {
    const toRemove: Object3D[] = [];
    for (const child of this.root.children) {
      if (
        child instanceof AmbientLight ||
        child instanceof DirectionalLight
      ) {
        toRemove.push(child);
      }
    }
    for (const c of toRemove) {
      this.root.remove(c);
      if ("dispose" in c && typeof c.dispose === "function") {
        (c as { dispose: () => void }).dispose();
      }
    }

    const look = this.look;
    const ambI =
      (look.ambient[0] + look.ambient[1] + look.ambient[2]) / 3;
    const ambient = new AmbientLight(0xffffff, Math.max(ambI * 1.2, 0.05));

    // Prefer HDR-extracted probes when available.
    let keyDir = new Vector3(look.keyDir[0], look.keyDir[1], look.keyDir[2]);
    let keyCol = new Color(look.keyColor[0], look.keyColor[1], look.keyColor[2]);
    let fillDir = new Vector3(
      look.fillDir[0],
      look.fillDir[1],
      look.fillDir[2],
    );
    let fillCol = new Color(
      look.fillColor[0],
      look.fillColor[1],
      look.fillColor[2],
    );

    if (this.studioEnv) {
      keyDir = this.studioEnv.keyDir.clone();
      fillDir = this.studioEnv.fillDir.clone();
      keyCol = new Color(
        this.studioEnv.keyColor.x,
        this.studioEnv.keyColor.y,
        this.studioEnv.keyColor.z,
      );
      fillCol = new Color(
        this.studioEnv.fillColor.x,
        this.studioEnv.fillColor.y,
        this.studioEnv.fillColor.z,
      );
    }

    const key = new DirectionalLight(
      keyCol.getHex(),
      Math.max(keyCol.r, keyCol.g, keyCol.b, 0.2),
    );
    key.position.copy(keyDir).multiplyScalar(500);
    const fill = new DirectionalLight(
      fillCol.getHex(),
      Math.max(fillCol.r, fillCol.g, fillCol.b, 0.1) * 0.8,
    );
    fill.position.copy(fillDir).multiplyScalar(400);
    const rim = new DirectionalLight(
      rgbToHex(look.rimColor),
      intensityOf(look.rimColor) * 0.4,
    );
    rim.position.set(look.rimDir[0], look.rimDir[1], look.rimDir[2]);
    this.root.add(ambient, key, fill, rim);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.renderer.init();
    } catch (err) {
      throw new Error(
        `WebGPURenderer.init failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean };
    if (backend.isWebGPUBackend !== true) {
      this.renderer.dispose();
      throw new Error(
        "WebGPU backend unavailable (Three.js fell back to WebGL2). " +
          "Pass a real GPUDevice from createWebGpuDevice() — do not rely on Three's featureLevel adapter path.",
      );
    }
    this.initialized = true;
    this.loop();
  }

  setContent(object: Object3D): void {
    this.clearGroup(this.content);
    this.content.add(object);
    object.renderOrder = 10;
    this.frameObject(object);
  }

  frameObject(object: Object3D): void {
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
    this.contentRadiusMm = radius;

    this.controls.target.copy(center);

    const distance =
      (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.35;
    const dir = new Vector3(1, -1.15, 0.85).normalize();
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.near = Math.max(distance / 500, 0.01);
    this.camera.far = distance * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    // Reset LOD so the next frame reapplies full quality at the framed view.
    this.appliedQuality = -1;
    this.appliedPixelRatio = 0;
    this.invalidate();
  }

  /**
   * Register a per-frame hook (e.g. cursor-follow animation).
   * Returns an unsubscribe function.
   */
  onFrame(cb: (dtMs: number) => void): () => void {
    this.frameHooks.add(cb);
    return () => {
      this.frameHooks.delete(cb);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.onResize);
    this.controls.removeEventListener("start", this.onControlsStart);
    this.controls.removeEventListener("end", this.onControlsEnd);
    this.frameHooks.clear();
    this.clearGroup(this.content);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private clearGroup(group: Group): void {
    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
      disposeObject(child);
    }
  }

  private rebuildScaleCues(): void {
    if (this.grid) {
      this.root.remove(this.grid);
      this.grid.geometry.dispose();
      const gMat = this.grid.material;
      if (Array.isArray(gMat)) gMat.forEach((m) => m.dispose());
      else gMat.dispose();
      this.grid = null;
    }
    if (this.axes) {
      this.root.remove(this.axes);
      this.axes.geometry.dispose();
      const aMat = this.axes.material;
      if (Array.isArray(aMat)) aMat.forEach((m) => m.dispose());
      else (aMat as { dispose?: () => void }).dispose?.();
      this.axes = null;
    }

    const gridSize = 400 * MM;
    const divisions = 40;
    const grid = new GridHelper(
      gridSize,
      divisions,
      this.look.gridCenter,
      this.look.gridLine,
    );
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0;
    grid.renderOrder = -20;
    this.root.add(grid);
    this.grid = grid;

    const axes = new AxesHelper(80 * MM);
    axes.renderOrder = -19;
    this.root.add(axes);
    this.axes = axes;
  }

  private readonly onResize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    // Force pixel-ratio reapply on resize (quality may already be scaled).
    this.appliedPixelRatio = 0;
    this.applyPixelRatioForQuality(this.appliedQuality < 0 ? 1 : this.appliedQuality);
    this.renderer.setSize(width, height, false);
    this.invalidate();
  };

  private readonly loop = (): void => {
    if (this.disposed || !this.initialized) return;
    this.animationId = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dtMs =
      this.lastFrameTime === 0
        ? 16.67
        : Math.min(now - this.lastFrameTime, 100);
    this.lastFrameTime = now;
    this.controls.update();
    this.camera.updateMatrixWorld();
    const camMoved = this.updateStillFactor(dtMs);
    for (const hook of this.frameHooks) {
      hook(dtMs);
    }
    const liveMoved = this.liveSphereChanged();
    const dirty =
      this.forceDirty ||
      this.controlsActive ||
      camMoved ||
      liveMoved ||
      this.idleMs < Viewport.STILL_SETTLE_MS;

    if (!dirty) {
      this.enterHold();
      return;
    }

    this.forceDirty = false;
    this.holding = false;
    this.updateZoomLod();
    this.renderer.render(this.scene, this.camera);
    this.tickFps();
  };

  /**
   * Track camera rest. Damping after orbit release keeps idleMs at 0 until
   * position/target stop changing. Returns true when the camera moved this frame.
   */
  private updateStillFactor(dtMs: number): boolean {
    const pos = this.camera.position;
    const target = this.controls.target;
    // ~0.5 mm — must sit above OrbitControls damping leftovers at framed distance.
    const moveEpsSq = 0.25;
    const moved =
      !this.camSampled ||
      pos.distanceToSquared(this.lastCamPos) > moveEpsSq ||
      target.distanceToSquared(this.lastTarget) > moveEpsSq;
    this.lastCamPos.copy(pos);
    this.lastTarget.copy(target);
    this.camSampled = true;

    if (this.controlsActive || moved) {
      this.idleMs = 0;
      return moved;
    }

    this.idleMs += dtMs;
    return false;
  }

  /** Snapshot live sphere uniforms; true when center/radius changed this frame. */
  private liveSphereChanged(): boolean {
    let fp = "";
    this.content.traverse((obj) => {
      if (!(obj instanceof Mesh) || !isRayMarchMesh(obj)) return;
      const handles = obj.userData[LIVE_SPHERE_USER] as
        | LiveSphereHandle[]
        | undefined;
      if (!handles) return;
      for (const h of handles) {
        const c = h.getCenter();
        fp += `${h.leafId}:${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${h.getRadius().toFixed(3)};`;
      }
    });
    if (fp === this.lastLiveFingerprint) return false;
    this.lastLiveFingerprint = fp;
    this.idleMs = 0;
    return true;
  }

  private enterHold(): void {
    if (this.holding) return;
    this.holding = true;
    this.fpsFrames = 0;
    this.fpsWindowStart = 0;
    this.fpsEl.textContent = "hold";
    this.fpsEl.dataset.fps = "high";
  }

  /**
   * Drop fill-rate + per-pixel shader work when zoomed in or when FPS sags.
   * Glass volume integration is quadratic-ish with on-screen solid area; zoom LOD
   * must be aggressive or close-up orbit freezes on laptop GPUs.
   *
   * Held frames skip this entirely — we never raise fill-rate just because
   * the camera stopped.
   */
  private updateZoomLod(): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    // Keep near/far sane while orbiting so close-ups do not clip or lose Z precision.
    const near = Math.max(dist / 600, 0.01);
    const far = Math.max(dist * 40, this.contentRadiusMm * 20, 500);
    if (
      Math.abs(this.camera.near - near) / near > 0.15 ||
      Math.abs(this.camera.far - far) / far > 0.15
    ) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }

    const halfFovY = (this.camera.fov * Math.PI) / 360;
    const viewHalfH = Math.max(dist * Math.tan(halfFovY), 1e-3);
    // ~0.74 at default frameObject() (radius fills ~74% of half-FOV). ≫1 when zoomed in.
    const screenFill = this.contentRadiusMm / viewHalfH;

    // Keep full look-dev through the framed view; only pull quality once past it.
    // Past framed: drop fast into the cheap volume path (q < 0.45 → no swirl/specks).
    const framedFill = 0.78;
    let zoomQ = 1;
    if (screenFill > framedFill) {
      // fill 0.78→1.0, 1.2→0.55, 1.6→0.25, 2.2→0.12
      zoomQ = Math.max(0.12, 1 - (screenFill - framedFill) * 0.95);
    }

    const quality = Math.min(
      1,
      Math.max(0.12, zoomQ * this.fpsBudgetScale),
    );

    // Always keep shader uniforms in sync (cheap). PR tiers are applied inside
    // applyPixelRatioForQuality with strong hysteresis.
    if (Math.abs(quality - this.appliedQuality) >= 0.02) {
      this.appliedQuality = quality;
      this.content.traverse((obj) => {
        if (obj instanceof Mesh && isRayMarchMesh(obj)) {
          applyRayMarchQuality(obj, quality);
        }
      });
    }
    this.applyPixelRatioForQuality(quality, screenFill);
  }

  /**
   * Pixel-ratio changes reallocate the drawing buffer — do them rarely, in coarse
   * steps only. Fine LOD is the shader uniforms (free). Thrashing PR while the
   * user dollys is a major source of zoom jank.
   *
   * Pixel ratio never goes above interactive maxPixelRatio — still frames
   * hold the last buffer instead of spending retina fill-rate.
   */
  private applyPixelRatioForQuality(quality: number, screenFill = 0.78): void {
    const dpr = window.devicePixelRatio || 1;
    const base = Math.min(dpr, this.look.maxPixelRatio);

    let tier = 1;
    const q = Math.min(1, Math.max(0.12, quality));
    if (screenFill > 2.2 || q < 0.25 || this.fpsBudgetScale < 0.55) {
      tier = 0.4;
    } else if (screenFill > 1.35 || q < 0.5 || this.fpsBudgetScale < 0.75) {
      tier = 0.65;
    }
    const pr = Math.max(0.3, base * tier);
    // Large hysteresis so we do not flip tiers every frame at a boundary.
    if (this.appliedPixelRatio > 0) {
      const rel = Math.abs(pr - this.appliedPixelRatio) / this.appliedPixelRatio;
      if (rel < 0.2) return;
    }
    this.appliedPixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
  }

  private tickFps(): void {
    const now = performance.now();
    if (this.fpsWindowStart === 0) {
      this.fpsWindowStart = now;
      this.fpsFrames = 0;
      return;
    }
    this.fpsFrames += 1;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 400) {
      const fps = (this.fpsFrames * 1000) / elapsed;
      this.fpsEma = this.fpsEma * 0.65 + fps * 0.35;
      // Target ~30 FPS interactive. Drop budget fast when cold; recover slowly.
      if (this.fpsEma < 24) {
        this.fpsBudgetScale = Math.max(0.35, this.fpsBudgetScale * 0.88);
        this.appliedQuality = -1; // force reapply next frame
      } else if (this.fpsEma < 30) {
        this.fpsBudgetScale = Math.max(0.4, this.fpsBudgetScale * 0.96);
        this.appliedQuality = -1;
      } else if (this.fpsEma > 48 && this.fpsBudgetScale < 1) {
        this.fpsBudgetScale = Math.min(1, this.fpsBudgetScale * 1.03);
        this.appliedQuality = -1;
      }
      this.fpsEl.textContent = `${fps.toFixed(0)} FPS`;
      this.fpsEl.dataset.fps = fps < 20 ? "low" : fps < 40 ? "mid" : "high";
      this.fpsFrames = 0;
      this.fpsWindowStart = now;
    }
  }
}

function ensureFpsElement(canvas: HTMLCanvasElement): HTMLElement {
  const existing = document.getElementById("fps-meter");
  if (existing) return existing;
  const el = document.createElement("div");
  el.id = "fps-meter";
  el.setAttribute("aria-live", "off");
  el.setAttribute("aria-label", "Frames per second");
  el.textContent = "— FPS";
  const host = canvas.parentElement ?? document.body;
  host.append(el);
  return el;
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh || child instanceof LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const m of materials) m.dispose();
    }
  });
}

function intensityOf(rgb: readonly [number, number, number]): number {
  return Math.max(rgb[0], rgb[1], rgb[2], 0.01);
}

function rgbToHex(rgb: readonly [number, number, number]): number {
  const s = intensityOf(rgb);
  const r = Math.min(1, rgb[0] / s);
  const g = Math.min(1, rgb[1] / s);
  const b = Math.min(1, rgb[2] / s);
  return new Color(r, g, b).getHex();
}

/** Re-export for callers that need the Texture type. */
export type { Texture };
