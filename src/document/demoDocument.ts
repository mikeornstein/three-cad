/**
 * Demo assembly document: translucent resin cube smooth-union metal sphere.
 * Built as serializable FieldNode so it goes through the evaluator path.
 *
 * Geometry:
 * - Cube 100×100×100 mm (resin) at origin → [0, 100]³
 * - Sphere diameter 100 mm, center at +X/+Y/+Z vertex (100,100,100) — metal
 * - smoothUnion (polynomial soft-min) for a continuous join (not a hard CSG crease)
 */

import {
  DOCUMENT_SCHEMA_VERSION,
  type AssemblyDocument,
  type PartDef,
} from "./types";
import {
  FIELD_TREE_GENERATOR_VERSION,
  type FieldNode,
} from "./fieldDef";

const CUBE_MM = 100;
const SPHERE_RADIUS_MM = 50;
const CORNER = [CUBE_MM, CUBE_MM, CUBE_MM] as const;

/**
 * Soft-min blend radius (mm). Larger = more continuous fillet-like join.
 * ~12 mm on a 100 mm cube keeps the form readable while removing the hard crease.
 */
export const DEMO_SMOOTH_UNION_K_MM = 12;

const demoCubeNode = (): FieldNode => ({
  op: "box",
  min: [0, 0, 0],
  max: [CUBE_MM, CUBE_MM, CUBE_MM],
  leafId: "demo-cube",
});

const demoSphereNode = (): FieldNode => ({
  op: "sphere",
  center: CORNER,
  radius: SPHERE_RADIUS_MM,
  leafId: "demo-sphere",
});

/**
 * Product demo field: continuous soft-min join (materials blend across the fillet).
 * Matching createDemoFieldSolid() / viewport display.
 */
export function demoFieldNode(): FieldNode {
  return {
    op: "smoothUnion",
    k: DEMO_SMOOTH_UNION_K_MM,
    leafId: "demo-union",
    a: demoCubeNode(),
    b: demoSphereNode(),
  };
}

/**
 * Hard min-union of the same leaves — used by analytic measure / topology tests
 * that assert square-minus-quarter-disk and exact 50 mm clipped edges.
 * Not the interactive demo (see {@link demoFieldNode}).
 */
export function demoHardUnionFieldNode(): FieldNode {
  return {
    op: "union",
    leafId: "demo-union",
    a: demoCubeNode(),
    b: demoSphereNode(),
  };
}

export function demoPartDef(): PartDef {
  return {
    id: "demo-body",
    kind: "generic",
    generator: {
      name: "fieldTree",
      version: FIELD_TREE_GENERATOR_VERSION,
    },
    payload: { field: demoFieldNode() },
    attributes: {
      name: "Demo resin cube ∪ metal sphere",
    },
  };
}

export function demoAssemblyDocument(): AssemblyDocument {
  const part = demoPartDef();
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    units: "mm",
    meta: { name: "demo" },
    parts: new Map([[part.id, part]]),
    instances: [{ id: "demo-instance", part: part.id, visible: true }],
  };
}
