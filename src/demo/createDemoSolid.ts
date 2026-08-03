/**
 * Scaffold demo solid — proves the SDF kernel path (mm, Z-up).
 * Not the full document evaluator; replaces the retired Manifold demo (#14).
 *
 * Geometry:
 * - Cube 100×100×100 mm, corner at origin → [0, 100]³
 * - Sphere diameter 100 mm (radius 50 mm), center at +X/+Y/+Z vertex (100,100,100)
 * - Union → single field solid, tessellated for the viewport
 *
 * Shading: flatShading so planar regions read as CAD-style planes.
 * (Welded MC verts + smooth normals would look lumpy on the cube.)
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
} from "three";
import {
  boxSolid,
  fieldToMesh,
  sphereSolid,
  union,
  type FieldSolid,
} from "../sdf";

const CUBE_MM = 100;
const SPHERE_DIAMETER_MM = 100;
const SPHERE_RADIUS_MM = SPHERE_DIAMETER_MM / 2;
const CORNER = [CUBE_MM, CUBE_MM, CUBE_MM] as const;

/** Display tessellation cell size (mm). Export can use a finer value later. */
const DISPLAY_CELL_MM = 1.5;

/** Build the demo field solid (authority representation). */
export function createDemoFieldSolid(): FieldSolid {
  const cube = boxSolid([0, 0, 0], [CUBE_MM, CUBE_MM, CUBE_MM], "demo-cube");
  const sphere = sphereSolid(CORNER, SPHERE_RADIUS_MM, "demo-sphere");
  return union(cube, sphere, "demo-union");
}

/**
 * Tessellate the demo field for Three.js.
 * Mesh is a derivative — keep the field if callers need measure/validity later.
 */
export function createDemoSolid(): Mesh {
  const field = createDemoFieldSolid();
  const meshData = fieldToMesh(field, { cellSizeMm: DISPLAY_CELL_MM });

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
    color: 0x6e9fd4,
    metalness: 0.12,
    roughness: 0.5,
    side: DoubleSide,
    flatShading: true,
  });

  const threeMesh = new Mesh(geometry, material);
  threeMesh.name = "demo-cube-sphere-union";
  // Stash field for future selection/measure work (non-enumerable-ish via userData).
  threeMesh.userData.fieldSolid = field;
  threeMesh.userData.cellSizeMm = DISPLAY_CELL_MM;
  return threeMesh;
}
