/**
 * Scaffold demo solid — proves document → evaluator → viewport (mm, Z-up).
 *
 * Geometry (via demo PartDef / FieldNode):
 * - Cube 100×100×100 mm, corner at origin → [0, 100]³
 * - Sphere diameter 100 mm (radius 50 mm), center at +X/+Y/+Z vertex (100,100,100)
 * - Union → single field solid
 *
 * Display: GPU sphere-trace (no marching cubes). Mesh remains export-only.
 */

import { Mesh } from "three";
import { demoFieldNode, demoPartDef } from "../document/demoDocument";
import {
  evaluatedPartToThreeMesh,
  getDefaultEvaluator,
} from "../eval";
import { createFieldRayMarchMesh } from "../render";
import type { FieldSolid } from "../sdf";

/** Export / legacy tessellation cell size (mm). Not used for default display. */
const EXPORT_CELL_MM = 1.5;

/**
 * Build the demo field solid via the evaluator (definition-hash cache).
 * Prefer this over hand-wired primitives so the viewport path matches docs.
 */
export function createDemoFieldSolid(): FieldSolid {
  const evaluated = getDefaultEvaluator().getField(demoPartDef());
  return evaluated.field;
}

/**
 * Default viewport solid: FieldNode → GLSL sphere-trace (no mesh).
 * Field + definitionHash live on userData for pick / measure.
 */
export function createDemoSolid(): Mesh {
  const part = demoPartDef();
  const { field, definitionHash } = getDefaultEvaluator().getField(part);
  return createFieldRayMarchMesh(demoFieldNode(), field, {
    name: "demo-cube-sphere-union",
    definitionHash,
  });
}

/**
 * Tessellate the demo field for export or mesh-backend experiments.
 * Not used by the default viewport path.
 */
export function createDemoMeshSolid(): Mesh {
  const part = demoPartDef();
  const evaluated = getDefaultEvaluator().evaluatePart(part, {
    cellSizeMm: EXPORT_CELL_MM,
  });
  return evaluatedPartToThreeMesh(evaluated, {
    name: "demo-cube-sphere-union",
  });
}
