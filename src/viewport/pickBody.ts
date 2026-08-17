/**
 * Leaf-based picking. Interaction talks in leafIds; each body kind
 * supplies a picker (analytic sphere / box today, field march later).
 */

import { Box3, Ray, Sphere, Vector3 } from "three";
import type { LiveSphereHandle } from "../render/createFieldRayMarchMesh";
import type { LiveTranslateHandle } from "../render/createFieldRayMarchMesh";

export interface BodyHit {
  readonly leafId: string;
  readonly point: Vector3;
  readonly t: number;
}

export interface BodyPicker {
  hit(ray: Ray): BodyHit | null;
  /** World-space ray → owning leaf, or null. */
  pick(ray: Ray, out?: Vector3): string | null;
}

function pickFromHit(hit: BodyHit | null, out?: Vector3): string | null {
  if (!hit) return null;
  out?.copy(hit.point);
  return hit.leafId;
}

function hitT(ray: Ray, point: Vector3): number {
  return point.clone().sub(ray.origin).dot(ray.direction);
}

export class LiveSpherePicker implements BodyPicker {
  constructor(
    private readonly handle: LiveSphereHandle,
    private readonly padMm: () => number,
  ) {}

  hit(ray: Ray): BodyHit | null {
    const center = this.handle.getCenter();
    const radius = this.handle.getRadius() + this.padMm();
    const point = new Vector3();
    if (ray.intersectSphere(new Sphere(center, radius), point) === null) {
      return null;
    }
    return { leafId: this.handle.leafId, point, t: hitT(ray, point) };
  }

  pick(ray: Ray, out?: Vector3): string | null {
    return pickFromHit(this.hit(ray), out);
  }
}

export class LiveBoxPicker implements BodyPicker {
  private readonly restMin: Vector3;
  private readonly restMax: Vector3;
  private readonly box = new Box3();
  private readonly scratchOff = new Vector3();

  constructor(
    private readonly handle: LiveTranslateHandle,
    restMin: Vector3,
    restMax: Vector3,
    private readonly padMm: () => number,
  ) {
    this.restMin = restMin.clone();
    this.restMax = restMax.clone();
  }

  hit(ray: Ray): BodyHit | null {
    const pad = this.padMm();
    this.handle.getOffset(this.scratchOff);
    this.box.min.copy(this.restMin).add(this.scratchOff).addScalar(-pad);
    this.box.max.copy(this.restMax).add(this.scratchOff).addScalar(pad);
    const point = new Vector3();
    if (ray.intersectBox(this.box, point) === null) return null;
    return { leafId: this.handle.leafId, point, t: hitT(ray, point) };
  }

  pick(ray: Ray, out?: Vector3): string | null {
    return pickFromHit(this.hit(ray), out);
  }
}

/** Nearest positive hit among child pickers. */
export class ClosestBodyPicker implements BodyPicker {
  constructor(private readonly pickers: readonly BodyPicker[]) {}

  hit(ray: Ray): BodyHit | null {
    let best: BodyHit | null = null;
    for (const p of this.pickers) {
      const h = p.hit(ray);
      if (h && h.t >= 0 && (!best || h.t < best.t)) best = h;
    }
    return best;
  }

  pick(ray: Ray, out?: Vector3): string | null {
    return pickFromHit(this.hit(ray), out);
  }
}
