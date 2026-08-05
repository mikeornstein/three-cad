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
import {
  demoFieldNode,
  demoHardUnionFieldNode,
  demoPartDef,
} from "../document/demoDocument";
import {
  evaluatedPartToThreeMesh,
  getDefaultEvaluator,
} from "../eval";
import { buildField } from "../eval/buildField";
import { createFieldRayMarchMesh } from "../render";
import type { FieldSolid } from "../sdf";
import { FIELD_TREE_GENERATOR_VERSION } from "../document/fieldDef";
import type { PartDef } from "../document/types";

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
 * Field + definitionHash live on userData for pick / measure.
 */
export function createDemoSolid(): Mesh {
  const part = demoPartDef();
  const { field, definitionHash } = getDefaultEvaluator().getField(part);
  return createFieldRayMarchMesh(demoFieldNode(), field, {
    name: "demo-cyan-amber-resin",
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
    name: "demo-cyan-amber-resin",
  });
}

/**
 * Hard min-union field (analytic CSG). For measure/topology tests that need
 * exact square-minus-quarter-disk geometry — not the smooth-union product demo.
 */
export function createHardUnionDemoFieldSolid(): FieldSolid {
  return buildField(demoHardUnionFieldNode());
}

/** Tessellated hard-union demo for mesh-accelerated topology tests. */
export function createHardUnionDemoMeshSolid(): Mesh {
  const part: PartDef = {
    id: "demo-body-hard-union",
    kind: "generic",
    generator: {
      name: "fieldTree",
      version: FIELD_TREE_GENERATOR_VERSION,
    },
    payload: { field: demoHardUnionFieldNode() },
    attributes: { name: "Demo hard-union (tests)" },
  };
  const evaluated = getDefaultEvaluator().evaluatePart(part, {
    cellSizeMm: EXPORT_CELL_MM,
  });
  return evaluatedPartToThreeMesh(evaluated, {
    name: "demo-hard-union-cube-sphere",
  });
}
