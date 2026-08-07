/**
 * Scaffold demo solid — proves document → evaluator → viewport (mm, Z-up).
 *
 * Geometry (via demo PartDef / FieldNode) — build order:
 * 1. Cube 100×100×100 mm (cyan resin) [0, 100]³
 * 2. Ø80 mm X/Y/Z cylinders through centroid → smoothUnion (100% overshoot)
 * 3. Subtract unioned cyls from cube → cut cube
 * 4. Sphere diameter 100 mm (amber resin) at (100,100,100)
 * 5. Soft-union sphere with cut cube (k=32)
 *
 * Display: WebGPU sphere-trace with HDRI studio lighting (no mesh).
 */

import { Mesh, type Texture } from "three";
import { demoFieldNode, demoPartDef } from "../document/demoDocument";
import {
  evaluatedPartToThreeMesh,
  getDefaultEvaluator,
} from "../eval";
import type { FieldSolid } from "../sdf";
import { createFieldRayMarchMesh } from "../render";
import { DEFAULT_LIBRARY_ENTRY } from "../render/library";
import type { SceneLook } from "../render/looks";

const EXPORT_CELL_MM = 1.5;

export function createDemoFieldSolid(): FieldSolid {
  const evaluated = getDefaultEvaluator().getField(demoPartDef());
  return evaluated.field;
}

export interface CreateDemoSolidOptions {
  /** Equirectangular HDR for IBL in the field shader. */
  readonly envMap?: Texture | null;
  readonly envIntensity?: number;
  readonly look?: SceneLook;
}

/**
 * Default viewport solid: FieldNode → WGSL sphere-trace (no mesh).
 * Materials + look from the materials library; pass envMap for real HDRI.
 */
export function createDemoSolid(options: CreateDemoSolidOptions = {}): Mesh {
  const part = demoPartDef();
  const { definitionHash } = getDefaultEvaluator().getField(part);
  const entry = DEFAULT_LIBRARY_ENTRY;
  const look = options.look ?? entry.look;
  return createFieldRayMarchMesh(demoFieldNode(), {
    name: "demo-cyan-amber-resin",
    definitionHash,
    material0: entry.material0,
    material1: entry.material1,
    look,
    envMap: options.envMap,
    envIntensity: options.envIntensity ?? look.envIntensity,
  });
}

export function createDemoMeshSolid(): Mesh {
  const part = demoPartDef();
  const evaluated = getDefaultEvaluator().evaluatePart(part, {
    cellSizeMm: EXPORT_CELL_MM,
  });
  return evaluatedPartToThreeMesh(evaluated, {
    name: "demo-cyan-amber-resin",
  });
}
