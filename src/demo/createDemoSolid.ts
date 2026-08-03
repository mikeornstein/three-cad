/**
 * Scaffold demo solid — proves document → evaluator → viewport (mm, Z-up).
 *
 * Geometry (via demo PartDef / FieldNode):
 * - Cube 100×100×100 mm, corner at origin → [0, 100]³
 * - Sphere diameter 100 mm (radius 50 mm), center at +X/+Y/+Z vertex (100,100,100)
 * - Union → single field solid, tessellated for the viewport
 *
 * Shading: flatShading so planar regions read as CAD-style planes.
 */

import { Mesh } from "three";
import { demoPartDef } from "../document/demoDocument";
import {
  evaluatedPartToThreeMesh,
  getDefaultEvaluator,
} from "../eval";
import type { FieldSolid } from "../sdf";

/** Display tessellation cell size (mm). Export can use a finer value later. */
const DISPLAY_CELL_MM = 1.5;

/**
 * Build the demo field solid via the evaluator (definition-hash cache).
 * Prefer this over hand-wired primitives so the viewport path matches docs.
 */
export function createDemoFieldSolid(): FieldSolid {
  const evaluated = getDefaultEvaluator().getField(demoPartDef());
  return evaluated.field;
}

/**
 * Tessellate the demo field for Three.js through FieldEvaluator.
 * Mesh is a derivative — field + definitionHash live on userData.
 */
export function createDemoSolid(): Mesh {
  const part = demoPartDef();
  const evaluated = getDefaultEvaluator().evaluatePart(part, {
    cellSizeMm: DISPLAY_CELL_MM,
  });
  return evaluatedPartToThreeMesh(evaluated, {
    name: "demo-cube-sphere-union",
  });
}
