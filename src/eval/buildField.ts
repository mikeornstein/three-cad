/**
 * Hydrate a serializable FieldNode into an evaluable FieldSolid.
 * Pure and worker-safe (no DOM / Three.js).
 */

import type { FieldNode } from "../document/fieldDef";
import {
  boxSolid,
  cylinderSolid,
  difference,
  intersection,
  offset,
  smoothUnion,
  sphereSolid,
  translate,
  union,
  type FieldSolid,
} from "../sdf";

export function buildField(node: FieldNode): FieldSolid {
  switch (node.op) {
    case "box":
      return boxSolid(node.min, node.max, node.leafId);
    case "sphere":
      return sphereSolid(node.center, node.radius, node.leafId);
    case "cylinder":
      return cylinderSolid(
        node.centerXy,
        node.radius,
        node.zMin,
        node.zMax,
        node.leafId,
      );
    case "union":
      return union(buildField(node.a), buildField(node.b), node.leafId);
    case "intersection":
      return intersection(buildField(node.a), buildField(node.b), node.leafId);
    case "difference":
      return difference(buildField(node.a), buildField(node.b), node.leafId);
    case "translate":
      return translate(buildField(node.solid), node.offset);
    case "offset":
      return offset(buildField(node.solid), node.delta, node.leafId);
    case "smoothUnion":
      return smoothUnion(
        buildField(node.a),
        buildField(node.b),
        node.k,
        node.leafId,
      );
    default: {
      const _exhaustive: never = node;
      throw new Error(
        `buildField: unknown op ${(_exhaustive as FieldNode).op}`,
      );
    }
  }
}
