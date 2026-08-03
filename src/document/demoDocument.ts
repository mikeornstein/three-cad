/**
 * Demo assembly document: cube ∪ sphere (same geometry as the scaffold demo).
 * Built as serializable FieldNode so it goes through the evaluator path.
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

/** Field tree matching createDemoFieldSolid() geometry and leaf ids. */
export function demoFieldNode(): FieldNode {
  return {
    op: "union",
    leafId: "demo-union",
    a: {
      op: "box",
      min: [0, 0, 0],
      max: [CUBE_MM, CUBE_MM, CUBE_MM],
      leafId: "demo-cube",
    },
    b: {
      op: "sphere",
      center: CORNER,
      radius: SPHERE_RADIUS_MM,
      leafId: "demo-sphere",
    },
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
    attributes: { name: "Demo cube ∪ sphere" },
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
