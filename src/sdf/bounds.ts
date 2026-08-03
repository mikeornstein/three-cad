import type { Aabb, Vec3 } from "./types";

export function aabb(
  min: Vec3,
  max: Vec3,
): Aabb {
  return {
    min: [min[0], min[1], min[2]],
    max: [max[0], max[1], max[2]],
  };
}

export function unionAabb(a: Aabb, b: Aabb): Aabb {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  };
}

export function translateAabb(box: Aabb, t: Vec3): Aabb {
  return {
    min: [box.min[0] + t[0], box.min[1] + t[1], box.min[2] + t[2]],
    max: [box.max[0] + t[0], box.max[1] + t[1], box.max[2] + t[2]],
  };
}

export function padAabb(box: Aabb, pad: number): Aabb {
  return {
    min: [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad],
    max: [box.max[0] + pad, box.max[1] + pad, box.max[2] + pad],
  };
}

export function aabbSize(box: Aabb): Vec3 {
  return [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
}
