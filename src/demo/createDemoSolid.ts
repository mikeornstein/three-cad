/**
 * Throwaway demo solid for the Phase 1 viewport scaffold.
 * Not the real evaluator — Manifold is used here only to prove the WASM path
 * and show a real-scale boolean in mm.
 *
 * Geometry:
 * - Cube 100×100×100 mm, corner at origin → [0, 100]³
 * - Sphere diameter 100 mm (radius 50 mm), center at +X/+Y/+Z vertex (100,100,100)
 * - Union → single manifold mesh
 *
 * Shading note: Manifold returns a *welded* mesh (shared verts at edges).
 * Smooth `computeVertexNormals()` averages face normals at those verts and
 * makes flat cube faces look puffy/lumpy. We use flatShading so planar faces
 * read as true planes (CAD-style).
 */

import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
} from "three";

const CUBE_MM = 100;
/** Diameter of the demo sphere in mm (radius = 50). */
const SPHERE_DIAMETER_MM = 100;
const SPHERE_RADIUS_MM = SPHERE_DIAMETER_MM / 2;
const CORNER: [number, number, number] = [CUBE_MM, CUBE_MM, CUBE_MM];
/** Geodesic segments for the sphere (higher = smoother). */
const SPHERE_SEGMENTS = 64;

export async function createDemoSolid(): Promise<Mesh> {
  const wasm = await Module({
    locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path),
  });
  wasm.setup();
  const { Manifold } = wasm;

  // Manifold cube defaults to first octant touching the origin (center=false).
  const cube = Manifold.cube([CUBE_MM, CUBE_MM, CUBE_MM], false);
  const sphere = Manifold.sphere(SPHERE_RADIUS_MM, SPHERE_SEGMENTS).translate(
    CORNER,
  );
  const solid = cube.add(sphere);

  try {
    const mesh = solid.getMesh();
    const geometry = manifoldMeshToGeometry(mesh);
    const material = new MeshStandardMaterial({
      color: 0x6e9fd4,
      metalness: 0.12,
      roughness: 0.5,
      side: DoubleSide,
      // Critical: welded Manifold meshes look "lumpy" with smooth normals.
      flatShading: true,
    });
    const threeMesh = new Mesh(geometry, material);
    threeMesh.name = "demo-cube-sphere-union";
    return threeMesh;
  } finally {
    solid.delete();
    sphere.delete();
    cube.delete();
  }
}

function manifoldMeshToGeometry(mesh: {
  numProp: number;
  numVert: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
}): BufferGeometry {
  const { numProp, numVert, vertProperties, triVerts } = mesh;
  const positions = new Float32Array(numVert * 3);

  for (let i = 0; i < numVert; i++) {
    const src = i * numProp;
    const dst = i * 3;
    positions[dst] = vertProperties[src]!;
    positions[dst + 1] = vertProperties[src + 1]!;
    positions[dst + 2] = vertProperties[src + 2]!;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(triVerts.slice(), 1));
  // Still useful for lighting when flatShading is off; with flatShading
  // Three.js derives per-face normals at draw time.
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
