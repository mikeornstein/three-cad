/**
 * Demo assembly document: translucent resin cube smooth-union metal sphere.
 * Built as serializable FieldNode so it goes through the evaluator path.
 *
 * Build order (feature tree):
 * 1. New cube 100×100×100 mm at [0, 100]³
 * 2. New Ø80 mm cylinders on X/Y/Z through centroid → smoothUnion → "unioned cyls"
 *    (100% overshoot past each cube face for clean thru-cuts)
 * 3. Subtract unioned cyls from cube → "cut cube"
 * 4. New sphere diameter 100 mm at +X/+Y/+Z vertex (100,100,100)
 * 5. Soft-union sphere with cut cube (k = DEMO_SMOOTH_UNION_K_MM)
 */

import {
  DOCUMENT_SCHEMA_VERSION,
  type AssemblyDocument,
  type PartDef,
} from "./types";
import {
  FIELD_TREE_GENERATOR_VERSION,
  type CylinderAxis,
  type FieldNode,
} from "./fieldDef";

export const DEMO_CUBE_MM = 100;
const CUBE_MM = DEMO_CUBE_MM;
/** Rest AABB of the demo cube (mm). */
export const DEMO_CUBE_MIN_MM = [0, 0, 0] as const;
export const DEMO_CUBE_MAX_MM = [CUBE_MM, CUBE_MM, CUBE_MM] as const;
/** Cube centroid — grab pivot and drill axes (mm). */
export const DEMO_CUBE_CENTER_MM = [
  CUBE_MM * 0.5,
  CUBE_MM * 0.5,
  CUBE_MM * 0.5,
] as const;
/** Demo sphere radius (mm). Exported for live grab-drag. */
export const DEMO_SPHERE_RADIUS_MM = 50;
const SPHERE_RADIUS_MM = DEMO_SPHERE_RADIUS_MM;
/** Modeled sphere center at the +X/+Y/+Z cube corner (mm). */
export const DEMO_SPHERE_CENTER_MM = [CUBE_MM, CUBE_MM, CUBE_MM] as const;
const CORNER = DEMO_SPHERE_CENTER_MM;
/** Cube centroid — all three drill axes pass through here. */
const CENTROID = CUBE_MM * 0.5;
/** Through-hole diameter (mm). */
const DRILL_DIAMETER_MM = 80;
const DRILL_RADIUS_MM = DRILL_DIAMETER_MM * 0.5;
/** How far drills extend past each cube face, as a fraction of cube size. */
const DRILL_OVERSHOOT_FRAC = 1.0;

/**
 * Soft-min blend radius (mm). Larger = more continuous fillet-like join.
 * ~32 mm on a 100 mm cube gives a broad cyan↔amber material gradient.
 */
export const DEMO_SMOOTH_UNION_K_MM = 32;

/** Soft-min for unioned drill cylinders (mm). Smaller = tighter hole crossings. */
export const DEMO_CYL_SMOOTH_UNION_K_MM = 1;

/** 1. New cube */
const demoCubeNode = (): FieldNode => ({
  op: "box",
  min: [0, 0, 0],
  max: [CUBE_MM, CUBE_MM, CUBE_MM],
  leafId: "demo-cube",
});

/** 4. New sphere */
const demoSphereNode = (): FieldNode => ({
  op: "sphere",
  center: CORNER,
  radius: SPHERE_RADIUS_MM,
  leafId: "demo-sphere",
});

/**
 * Finite cylinder along `axis` through the cube centroid.
 * Extent overshoots each cube face by DRILL_OVERSHOOT_FRAC of the cube size.
 */
const demoDrillCylinder = (axis: CylinderAxis, leafId: string): FieldNode => {
  const overshoot = CUBE_MM * DRILL_OVERSHOOT_FRAC;
  return {
    op: "cylinder",
    axis,
    centerXy: [CENTROID, CENTROID],
    radius: DRILL_RADIUS_MM,
    zMin: -overshoot,
    zMax: CUBE_MM + overshoot,
    leafId,
  };
};

/** Drill axis extent used by tests / hand-built mirrors. */
export const DEMO_DRILL_AXIS_MIN = -CUBE_MM * DRILL_OVERSHOOT_FRAC;
export const DEMO_DRILL_AXIS_MAX = CUBE_MM + CUBE_MM * DRILL_OVERSHOOT_FRAC;

/** 2. Three cylinders → smoothUnion → "unioned cyls" (lightly rounded crossings) */
const demoUnionedCyls = (): FieldNode => ({
  op: "smoothUnion",
  k: DEMO_CYL_SMOOTH_UNION_K_MM,
  leafId: "unioned-cyls",
  a: {
    op: "smoothUnion",
    k: DEMO_CYL_SMOOTH_UNION_K_MM,
    a: demoDrillCylinder("x", "demo-cyl-x"),
    b: demoDrillCylinder("y", "demo-cyl-y"),
  },
  b: demoDrillCylinder("z", "demo-cyl-z"),
});

/** 3. Subtract unioned cyls from cube → "cut cube" */
const demoCutCube = (): FieldNode => ({
  op: "difference",
  leafId: "cut-cube",
  a: demoCubeNode(),
  b: demoUnionedCyls(),
});

/**
 * Product demo field: cut cube (cube − unioned cyls), then soft-union sphere.
 */
export function demoFieldNode(): FieldNode {
  return {
    op: "smoothUnion",
    k: DEMO_SMOOTH_UNION_K_MM,
    leafId: "demo-union",
    a: demoCutCube(),
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
      name: "Demo cyan + amber resin (cut cube + smoothUnion sphere)",
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
