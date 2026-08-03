/**
 * Turn an evaluated mesh into a Three.js Mesh with field authority stashed.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
} from "three";
import type { FieldSolid } from "../sdf";
import type { EvaluatedPart } from "./evaluator";

export interface ToThreeMeshOptions {
  readonly name?: string;
  readonly color?: number;
  readonly definitionHash?: string;
}

export function evaluatedPartToThreeMesh(
  evaluated: EvaluatedPart,
  options: ToThreeMeshOptions = {},
): Mesh {
  return derivedToThreeMesh(evaluated.mesh, evaluated.field, {
    name: options.name,
    color: options.color,
    definitionHash: options.definitionHash ?? evaluated.definitionHash,
    cellSizeMm: evaluated.quality.cellSizeMm,
  });
}

export function derivedToThreeMesh(
  meshData: { readonly positions: Float32Array; readonly indices: Uint32Array },
  field: FieldSolid,
  options: {
    readonly name?: string;
    readonly color?: number;
    readonly definitionHash?: string;
    readonly cellSizeMm?: number;
  } = {},
): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(meshData.positions, 3),
  );
  geometry.setIndex(new BufferAttribute(meshData.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new MeshStandardMaterial({
    color: options.color ?? 0x6e9fd4,
    metalness: 0.12,
    roughness: 0.5,
    side: DoubleSide,
    flatShading: true,
  });

  const threeMesh = new Mesh(geometry, material);
  if (options.name) threeMesh.name = options.name;
  threeMesh.userData.fieldSolid = field;
  if (options.definitionHash !== undefined) {
    threeMesh.userData.definitionHash = options.definitionHash;
  }
  if (options.cellSizeMm !== undefined) {
    threeMesh.userData.cellSizeMm = options.cellSizeMm;
  }
  return threeMesh;
}
