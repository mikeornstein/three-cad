/**
 * Serializable field definition tree (document → evaluator).
 *
 * FieldSolid closures cannot cross workers or JSON; FieldNode can.
 * The evaluator hydrates FieldNode → FieldSolid and caches by definition hash.
 */

import type { Vec3 } from "../sdf/types";

/** Discriminated union of field ops. Pure data — no functions. */
export type FieldNode =
  | BoxNode
  | SphereNode
  | CylinderNode
  | UnionNode
  | IntersectionNode
  | DifferenceNode
  | TranslateNode
  | OffsetNode
  | SmoothUnionNode;

export interface BoxNode {
  readonly op: "box";
  readonly min: Vec3;
  readonly max: Vec3;
  readonly leafId?: string;
}

export interface SphereNode {
  readonly op: "sphere";
  readonly center: Vec3;
  readonly radius: number;
  readonly leafId?: string;
}

/** Axis a finite cylinder is extruded along. Default `"z"`. */
export type CylinderAxis = "x" | "y" | "z";

export interface CylinderNode {
  readonly op: "cylinder";
  /**
   * Extrusion axis. Default `"z"`.
   * `centerXy` is the center in the plane perpendicular to the axis:
   * XY for z, YZ for x, XZ for y.
   */
  readonly axis?: CylinderAxis;
  readonly centerXy: readonly [number, number];
  readonly radius: number;
  /** Extent along `axis` (mm). Field names are historical (Z-only API). */
  readonly zMin: number;
  readonly zMax: number;
  readonly leafId?: string;
}

export interface UnionNode {
  readonly op: "union";
  readonly a: FieldNode;
  readonly b: FieldNode;
  readonly leafId?: string;
}

export interface IntersectionNode {
  readonly op: "intersection";
  readonly a: FieldNode;
  readonly b: FieldNode;
  readonly leafId?: string;
}

export interface DifferenceNode {
  readonly op: "difference";
  readonly a: FieldNode;
  readonly b: FieldNode;
  readonly leafId?: string;
}

export interface TranslateNode {
  readonly op: "translate";
  readonly solid: FieldNode;
  readonly offset: Vec3;
}

export interface OffsetNode {
  readonly op: "offset";
  readonly solid: FieldNode;
  readonly delta: number;
  readonly leafId?: string;
}

export interface SmoothUnionNode {
  readonly op: "smoothUnion";
  readonly a: FieldNode;
  readonly b: FieldNode;
  readonly k: number;
  readonly leafId?: string;
}

/**
 * Payload the evaluator hashes and hydrates for a generic part.
 * Geometry authority for parametric parts (no mesh bytes).
 */
export interface PartFieldPayload {
  readonly field: FieldNode;
}

/** Generator identity — version bumps invalidate caches. */
export interface FieldGeneratorRef {
  readonly name: "fieldTree";
  readonly version: number;
}

/** Current field-tree generator version (bump when hydrate semantics change). */
export const FIELD_TREE_GENERATOR_VERSION = 1 as const;
