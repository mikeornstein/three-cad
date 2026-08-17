/**
 * Demo interaction: long-press the live sphere to grab and drag it.
 * Hold locks orbit; release leaves the sphere in place and unlocks orbit.
 */

import {
  Plane,
  Ray,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
  type Camera,
  type PerspectiveCamera,
} from "three";
import {
  HIGHLIGHT_AMOUNT,
  HIGHLIGHT_EASE_MS,
  easeToward,
  highlightCursor,
  highlightLevelFor,
  type FieldHighlight,
  type HighlightLevel,
} from "../render/fieldHighlight";
import type { LiveSphereHandle } from "../render/createFieldRayMarchMesh";
import { LiveSpherePicker, type BodyPicker } from "../viewport/pickBody";
import type { Viewport } from "../viewport/Viewport";

/** Same beat as the hover ease — grab commits as the wake finishes. */
export const HOLD_MS = HIGHLIGHT_EASE_MS;
export const SLOP_PX = 8;
const POP_MS = 220;
/** Soft workspace half-extent past rest center (mm). */
const WORKSPACE_PAD_MM = 220;

export type GrabPhase = "idle" | "pending" | "grabbing";

export type GrabEvent =
  | { type: "down-on-sphere" }
  | { type: "move"; movedPx: number; slopPx: number }
  | { type: "hold" }
  | { type: "up" };

export interface SphereGrabOptions {
  readonly viewport: Viewport;
  readonly liveSphere: LiveSphereHandle;
  readonly highlight: FieldHighlight;
  readonly canvas: HTMLCanvasElement;
  /** Defaults to an analytic picker on `liveSphere`. */
  readonly picker?: BodyPicker;
  readonly log?: (msg: string) => void;
}

export function hitPadMm(coarse: boolean): number {
  return coarse ? 8 : 2;
}

export function reduceGrabPhase(phase: GrabPhase, event: GrabEvent): GrabPhase {
  switch (event.type) {
    case "down-on-sphere":
      return phase === "idle" ? "pending" : phase;
    case "move":
      if (phase === "pending" && event.movedPx > event.slopPx) return "idle";
      return phase;
    case "hold":
      return phase === "pending" ? "grabbing" : phase;
    case "up":
      return "idle";
  }
}

export function rayHitsSphere(
  ray: Ray,
  center: Vector3,
  radius: number,
  out: Vector3,
): boolean {
  return ray.intersectSphere(new Sphere(center, radius), out) !== null;
}

/**
 * World center from a camera-facing plane hit plus the grab-time offset
 * (keeps the sphere from snapping so its center sits under the pointer).
 */
export function grabCenterFromHit(
  planeHit: Vector3,
  offset: Vector3,
  workMin: Vector3,
  workMax: Vector3,
  out: Vector3,
): Vector3 {
  return out.copy(planeHit).add(offset).clamp(workMin, workMax);
}

export class SphereGrab {
  private readonly viewport: Viewport;
  private readonly live: LiveSphereHandle;
  private readonly highlight: FieldHighlight;
  private readonly picker: BodyPicker;
  private readonly canvas: HTMLCanvasElement;
  private readonly log?: (msg: string) => void;

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly plane = new Plane();
  private readonly hit = new Vector3();
  private readonly camDir = new Vector3();
  private readonly pointer = new Vector2(0.5, 0.5);
  private readonly grabOffset = new Vector3();
  private readonly workMin = new Vector3();
  private readonly workMax = new Vector3();
  private readonly camSnapPos = new Vector3();
  private readonly camSnapTarget = new Vector3();
  private readonly downClient = new Vector2();

  private phase: GrabPhase = "idle";
  private pointerId = -1;
  private holdTimer = 0;
  private disposed = false;
  private popAnim: { t0: number; duration: number } | null = null;
  private pointerButtons = 0;
  private hasPointer = false;
  private hoverLeafId: string | null = null;
  private highlightAmount = 0;
  private highlightLevel: HighlightLevel = "rest";

  private readonly unsubFrame: () => void;

  constructor(options: SphereGrabOptions) {
    this.viewport = options.viewport;
    this.live = options.liveSphere;
    this.highlight = options.highlight;
    this.picker =
      options.picker ??
      new LiveSpherePicker(options.liveSphere, () =>
        hitPadMm(isCoarseViewport()),
      );
    this.canvas = options.canvas;
    this.log = options.log;

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

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);

    this.unsubFrame = this.viewport.onFrame(this.tick);
    this.setPhase("idle");
    this.writeCenterAttr();
    this.log?.("long-press the sphere to drag");
  }

  get grabbing(): boolean {
    return this.phase === "grabbing";
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHoldTimer();
    if (this.phase === "grabbing") {
      this.viewport.unlockOrbit();
    }
    this.setPhase("idle");
    this.unsubFrame();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.releaseCapture();
    this.canvas.style.cursor = "";
    this.highlight.setAmount(0);
    this.highlight.setTarget(null);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.disposed || e.button !== 0) return;
    if (this.phase !== "idle") return;
    this.syncPointer(e);
    this.pointerButtons = e.buttons;
    this.ndcFromPointer();
    this.raycaster.setFromCamera(this.ndc, this.viewport.camera as Camera);
    const hitLeaf = this.picker.pick(this.raycaster.ray, this.hit);
    if (hitLeaf === null) {
      return;
    }
    this.hoverLeafId = hitLeaf;

    this.setPhase(reduceGrabPhase(this.phase, { type: "down-on-sphere" }));
    this.pointerId = e.pointerId;
    this.downClient.set(e.clientX, e.clientY);
    this.camSnapPos.copy(this.viewport.camera.position);
    this.camSnapTarget.copy(this.viewport.controls.target);
    this.clearHoldTimer();
    this.holdTimer = window.setTimeout(this.onHold, HOLD_MS);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;
    this.syncPointer(e);
    this.pointerButtons = e.buttons;
    if (this.phase === "pending" && e.pointerId === this.pointerId) {
      const moved = Math.hypot(
        e.clientX - this.downClient.x,
        e.clientY - this.downClient.y,
      );
      const next = reduceGrabPhase(this.phase, {
        type: "move",
        movedPx: moved,
        slopPx: SLOP_PX,
      });
      if (next === "idle") {
        this.clearHoldTimer();
        this.setPhase("idle");
        this.pointerId = -1;
        return;
      }
    }
    if (this.phase === "grabbing" && e.pointerId === this.pointerId) {
      this.applyGrab();
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.disposed) return;
    if (this.pointerId !== -1 && e.pointerId !== this.pointerId) return;
    if (this.phase === "idle") return;
    const wasGrab = this.phase === "grabbing";
    this.clearHoldTimer();
    this.setPhase(reduceGrabPhase(this.phase, { type: "up" }));
    if (wasGrab) {
      this.viewport.unlockOrbit();
      this.releaseCapture();
      this.applyCursor();
      this.log?.("sphere drop");
    }
    this.pointerId = -1;
    this.pointerButtons = e.buttons;
  };

  private readonly onPointerLeave = (): void => {
    this.hasPointer = false;
    this.pointerButtons = 0;
    if (this.phase === "idle") {
      this.hoverLeafId = null;
    }
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.phase === "pending" || this.phase === "grabbing") {
      e.preventDefault();
    }
  };

  private readonly onHold = (): void => {
    this.holdTimer = 0;
    if (this.disposed || this.phase !== "pending") return;
    const next = reduceGrabPhase(this.phase, { type: "hold" });
    this.setPhase(next);
    if (next !== "grabbing") return;

    this.viewport.lockOrbit({
      position: this.camSnapPos,
      target: this.camSnapTarget,
    });
    try {
      this.canvas.setPointerCapture(this.pointerId);
    } catch {
      // Capture is optional; OrbitControls may already hold it.
    }
    this.applyCursor();

    const camera = this.viewport.camera as PerspectiveCamera;
    this.live.getCenter(this.hit);
    camera.getWorldDirection(this.camDir);
    this.plane.setFromNormalAndCoplanarPoint(this.camDir, this.hit);
    this.ndcFromPointer();
    this.raycaster.setFromCamera(this.ndc, camera as Camera);
    const planeHit = this.raycaster.ray.intersectPlane(this.plane, new Vector3());
    if (planeHit) {
      this.grabOffset.copy(this.hit).sub(planeHit);
    } else {
      this.grabOffset.set(0, 0, 0);
    }

    this.popAnim = { t0: performance.now(), duration: POP_MS };
    this.log?.("sphere grab");
  };

  private applyGrab(): void {
    const camera = this.viewport.camera as Camera;
    this.ndcFromPointer();
    this.raycaster.setFromCamera(this.ndc, camera);
    const planeHit = this.raycaster.ray.intersectPlane(this.plane, this.hit);
    if (!planeHit) return;
    grabCenterFromHit(
      planeHit,
      this.grabOffset,
      this.workMin,
      this.workMax,
      this.hit,
    );
    this.live.setCenter(this.hit);
    this.writeCenterAttr();
  }

  private readonly tick = (dtMs: number): void => {
    if (this.disposed) return;
    this.syncHover();
    this.syncHighlight(dtMs);
    if (!this.popAnim) return;
    const now = performance.now();
    const u = clamp01((now - this.popAnim.t0) / this.popAnim.duration);
    this.live.setRadius(this.live.restRadius * popScale(u));
    if (u >= 1) {
      this.popAnim = null;
      this.live.setRadius(this.live.restRadius);
    }
  };

  private setPhase(next: GrabPhase): void {
    this.phase = next;
    this.canvas.dataset.sphereGrab = next;
    this.applyCursor();
  }

  private syncHover(): void {
    if (this.phase !== "idle") {
      this.hoverLeafId = this.live.leafId;
      return;
    }
    if (!this.hasPointer || this.pointerButtons !== 0) {
      this.hoverLeafId = null;
      return;
    }
    this.ndcFromPointer();
    this.raycaster.setFromCamera(this.ndc, this.viewport.camera as Camera);
    this.hoverLeafId = this.picker.pick(this.raycaster.ray);
  }

  private syncHighlight(dtMs: number): void {
    const level = highlightLevelFor({
      hoverLeafId: this.hoverLeafId,
      phase: this.phase,
      pointerButtons: this.pointerButtons,
    });
    this.highlightLevel = level;
    const targetAmount = HIGHLIGHT_AMOUNT[level];
    const leaf =
      this.phase !== "idle" ? this.live.leafId : this.hoverLeafId;
    if (leaf) {
      this.highlight.setTarget(leaf);
    }
    this.highlightAmount = easeToward(
      this.highlightAmount,
      targetAmount,
      dtMs,
      HIGHLIGHT_EASE_MS,
    );
    this.highlight.setAmount(this.highlightAmount);
    if (this.highlightAmount <= 0 && this.phase === "idle") {
      this.highlight.setTarget(null);
    }
    this.canvas.dataset.highlightLevel = level;
    this.canvas.dataset.highlightAmount = this.highlightAmount.toFixed(2);
    this.applyCursor();
  }

  private applyCursor(): void {
    this.canvas.style.cursor = highlightCursor(
      this.highlightLevel,
      this.phase,
    );
  }

  private writeCenterAttr(): void {
    const c = this.live.getCenter();
    this.canvas.dataset.sphereCenter = `${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)}`;
  }

  private syncPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointer.x = (e.clientX - rect.left) / rect.width;
    this.pointer.y = (e.clientY - rect.top) / rect.height;
    this.hasPointer = true;
  }

  private ndcFromPointer(): void {
    this.ndc.x = this.pointer.x * 2 - 1;
    this.ndc.y = -(this.pointer.y * 2 - 1);
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== 0) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = 0;
    }
  }

  private releaseCapture(): void {
    if (this.pointerId < 0) return;
    try {
      this.canvas.releasePointerCapture(this.pointerId);
    } catch {
      // Already released by OrbitControls or never captured.
    }
  }
}

function isCoarseViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function popScale(u: number): number {
  if (u < 0.35) {
    const t = u / 0.35;
    return 0.72 + 0.28 * easeOutCubic(t);
  }
  const t = (u - 0.35) / 0.65;
  const bounce = Math.sin(t * Math.PI) * (1 - t);
  return 1 + 0.14 * bounce * (1 - t * 0.3);
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}
