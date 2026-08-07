/**
 * Demo interaction: Space toggles sphere cursor-follow.
 * Live center/radius uniforms drive smoothUnion on the GPU each frame.
 */

import {
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
  type PerspectiveCamera,
} from "three";
import type { LiveSphereHandle } from "../render/createFieldRayMarchMesh";
import type { Viewport } from "../viewport/Viewport";

const POP_MS = 220;
const POS_EASE_MS = 200;
/** Soft workspace half-extent past rest center (mm). */
const WORKSPACE_PAD_MM = 220;

export interface SphereCursorFollowOptions {
  readonly viewport: Viewport;
  readonly liveSphere: LiveSphereHandle;
  readonly canvas: HTMLCanvasElement;
  /** Optional console logger for mode changes. */
  readonly log?: (msg: string) => void;
}

export class SphereCursorFollow {
  private readonly viewport: Viewport;
  private readonly live: LiveSphereHandle;
  private readonly canvas: HTMLCanvasElement;
  private readonly log?: (msg: string) => void;

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly plane = new Plane();
  private readonly hit = new Vector3();
  private readonly camDir = new Vector3();
  private readonly pointer = new Vector2(0.5, 0.5);
  private readonly target = new Vector3();
  private readonly fromCenter = new Vector3();
  private readonly toCenter = new Vector3();
  private readonly workMin = new Vector3();
  private readonly workMax = new Vector3();

  private follow = false;
  private pointerButtons = 0;
  private hasPointer = false;
  private disposed = false;

  /** 0..1 position blend during enter/exit; null when idle. */
  private posAnim: {
    t0: number;
    duration: number;
    from: Vector3;
    to: Vector3;
  } | null = null;
  /** Pop scale overshoot timeline. */
  private popAnim: { t0: number; duration: number } | null = null;

  private readonly unsubFrame: () => void;

  constructor(options: SphereCursorFollowOptions) {
    this.viewport = options.viewport;
    this.live = options.liveSphere;
    this.canvas = options.canvas;
    this.log = options.log;

    this.target.copy(this.live.restCenter);
    this.fromCenter.copy(this.live.restCenter);
    this.toCenter.copy(this.live.restCenter);

    const rest = this.live.restCenter;
    this.workMin.set(
      rest.x - WORKSPACE_PAD_MM,
      rest.y - WORKSPACE_PAD_MM,
      rest.z - WORKSPACE_PAD_MM,
    );
    this.workMax.set(
      rest.x + WORKSPACE_PAD_MM,
      rest.y + WORKSPACE_PAD_MM,
      rest.z + WORKSPACE_PAD_MM,
    );

    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("keydown", this.onKeyDown);

    this.unsubFrame = this.viewport.onFrame(this.tick);
    this.log?.("space: toggle sphere cursor follow");
  }

  get following(): boolean {
    return this.follow;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubFrame();
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("keydown", this.onKeyDown);
    // Restore rest pose.
    this.live.setCenter(this.live.restCenter);
    this.live.setRadius(this.live.restRadius);
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointer.x = (e.clientX - rect.left) / rect.width;
    this.pointer.y = (e.clientY - rect.top) / rect.height;
    this.hasPointer = true;
    this.pointerButtons = e.buttons;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointerButtons = e.buttons;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.pointerButtons = e.buttons;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerButtons = 0;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== "Space" || e.repeat) return;
    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    this.toggle();
  };

  private toggle(): void {
    this.follow = !this.follow;
    const now = performance.now();
    this.live.getCenter(this.fromCenter);

    if (this.follow) {
      this.projectPointer(this.toCenter);
      this.log?.("sphere follow: on");
    } else {
      this.toCenter.copy(this.live.restCenter);
      this.log?.("sphere follow: off → rest pose");
    }

    this.posAnim = {
      t0: now,
      duration: POS_EASE_MS,
      from: this.fromCenter.clone(),
      to: this.toCenter.clone(),
    };
    this.popAnim = { t0: now, duration: POP_MS };
  }

  private readonly tick = (_dtMs: number): void => {
    if (this.disposed) return;
    const now = performance.now();

    // While following and not orbiting, chase the pointer.
    if (this.follow && this.pointerButtons === 0 && this.hasPointer) {
      this.projectPointer(this.target);
      if (this.posAnim) {
        // Retarget mid-animation toward the live cursor.
        this.posAnim.to.copy(this.target);
      } else {
        this.live.setCenter(this.target);
      }
    }

    if (this.posAnim) {
      const u = clamp01((now - this.posAnim.t0) / this.posAnim.duration);
      const e = easeOutCubic(u);
      this.hit.lerpVectors(this.posAnim.from, this.posAnim.to, e);
      this.live.setCenter(this.hit);
      if (u >= 1) {
        this.posAnim = null;
        if (!this.follow) {
          this.live.setCenter(this.live.restCenter);
        }
      }
    }

    if (this.popAnim) {
      const u = clamp01((now - this.popAnim.t0) / this.popAnim.duration);
      const scale = popScale(u);
      this.live.setRadius(this.live.restRadius * scale);
      if (u >= 1) {
        this.popAnim = null;
        this.live.setRadius(this.live.restRadius);
      }
    }
  };

  /**
   * Screen-depth plane through the current sphere center, facing the camera.
   * Keeps the sphere under the cursor in screen space while orbiting.
   */
  private projectPointer(out: Vector3): void {
    const camera = this.viewport.camera as PerspectiveCamera;
    this.ndc.x = this.pointer.x * 2 - 1;
    this.ndc.y = -(this.pointer.y * 2 - 1);
    this.raycaster.setFromCamera(this.ndc, camera as Camera);

    this.live.getCenter(this.hit);
    camera.getWorldDirection(this.camDir);
    this.plane.setFromNormalAndCoplanarPoint(this.camDir, this.hit);

    const ok = this.raycaster.ray.intersectPlane(this.plane, out);
    if (!ok) {
      out.copy(this.hit);
      return;
    }
    out.clamp(this.workMin, this.workMax);
  }
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * Pop scale: dip → overshoot → settle at 1.
 * u in [0,1] → scale multiplier.
 */
function popScale(u: number): number {
  // Two-phase: 0–0.35 squash, 0.35–1 elastic settle.
  if (u < 0.35) {
    const t = u / 0.35;
    return 0.72 + 0.28 * easeOutCubic(t);
  }
  const t = (u - 0.35) / 0.65;
  // Overshoot then settle: 1.14 → 1.0
  const bounce = Math.sin(t * Math.PI) * (1 - t);
  return 1 + 0.14 * bounce * (1 - t * 0.3);
}
