/**
 * Scaffold demo solid — proves document → evaluator → viewport (mm, Z-up).
 *
 * Geometry (via demo PartDef / FieldNode):
 * - Cube 100×100×100 mm (cyan resin), corner at origin → [0, 100]³
 * - Sphere diameter 100 mm (amber resin), center at +X/+Y/+Z vertex (100,100,100)
 * - smoothUnion (soft-min) → continuous dual-transparent material gradient
 *
 * Display: WebGPU sphere-trace (no marching cubes). Mesh remains export-only.
 */

import { Mesh } from "three";
import { demoFieldNode, demoPartDef } from "../document/demoDocument";
import {
  evaluatedPartToThreeMesh,
  getDefaultEvaluator,
} from "../eval";
import type { FieldSolid } from "../sdf";
import { createFieldRayMarchMesh } from "../render";
import { DEFAULT_LIBRARY_ENTRY } from "../render/library";

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
 * Default viewport solid: FieldNode → WGSL sphere-trace (no mesh).
 * Materials + look from the materials library (refs/mat_ref_01 by default).
 */
export function createDemoSolid(): Mesh {
  const part = demoPartDef();
  const { definitionHash } = getDefaultEvaluator().getField(part);
  const entry = DEFAULT_LIBRARY_ENTRY;
  return createFieldRayMarchMesh(demoFieldNode(), {
    name: "demo-cyan-amber-resin",
    definitionHash,
    material0: entry.material0,
    material1: entry.material1,
    look: entry.look,
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
    name: "demo-cyan-amber-resin",
  });
}
