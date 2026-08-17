/**
 * Leaf-based picking. Interaction talks in leafIds; each body kind
 * supplies a picker (analytic sphere today, field march later).
 */

import { Ray, Sphere, Vector3 } from "three";
import type { LiveSphereHandle } from "../render/createFieldRayMarchMesh";

export interface BodyPicker {
  /** World-space ray → owning leaf, or null. */
  pick(ray: Ray, out?: Vector3): string | null;
}

export class LiveSpherePicker implements BodyPicker {
  constructor(
    private readonly handle: LiveSphereHandle,
    private readonly padMm: () => number,
  ) {}

  pick(ray: Ray, out = new Vector3()): string | null {
    const center = this.handle.getCenter();
    const radius = this.handle.getRadius() + this.padMm();
    if (ray.intersectSphere(new Sphere(center, radius), out) === null) {
      return null;
    }
    return this.handle.leafId;
  }
}
