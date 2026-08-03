/**
 * Classic marching cubes: FieldSolid → triangle mesh (derived only).
 *
 * Not feature-preserving (sharp edges soften / stair-step at low res).
 * Dual contouring can replace this later for machined-looking exports.
 *
 * Lookup tables: isosurface@1.0.0 (Mikola Lysenko / Paul Bourke), MIT.
 */

import { padAabb } from "../bounds";
import type { DerivedMesh, FieldSolid, MeshQuality } from "../types";
import { EDGE_TABLE, TRI_TABLE } from "./mcTables";

/** Corner offsets in cell units. */
const CUBE_VERTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

/** Edge → endpoint corner indices. */
const EDGE_INDEX: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * Tessellate isosurface f = 0 into a triangle mesh (mm).
 * Winding aims for outward normals given our sign convention (f < 0 inside).
 */
export function fieldToMesh(
  solid: FieldSolid,
  quality: MeshQuality,
): DerivedMesh {
  const cell = quality.cellSizeMm;
  if (!(cell > 0)) {
    throw new Error(`fieldToMesh: cellSizeMm must be > 0, got ${cell}`);
  }
  const pad = quality.padMm ?? cell;
  const box = padAabb(solid.bounds, pad);

  const nx = Math.max(1, Math.ceil((box.max[0] - box.min[0]) / cell));
  const ny = Math.max(1, Math.ceil((box.max[1] - box.min[1]) / cell));
  const nz = Math.max(1, Math.ceil((box.max[2] - box.min[2]) / cell));

  // Sample grid: (nx+1)×(ny+1)×(nz+1)
  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;
  const samples = new Float32Array(sx * sy * sz);

  const gIdx = (i: number, j: number, k: number): number =>
    i + sx * (j + sy * k);

  for (let k = 0; k < sz; k++) {
    const z = box.min[2] + k * cell;
    for (let j = 0; j < sy; j++) {
      const y = box.min[1] + j * cell;
      for (let i = 0; i < sx; i++) {
        const x = box.min[0] + i * cell;
        samples[gIdx(i, j, k)] = solid.evaluate(x, y, z);
      }
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];

  const cornerVal = new Float32Array(8);
  const edgeVertIndex = new Int32Array(12);

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = CUBE_VERTS[c]!;
          const v = samples[gIdx(i + di, j + dj, k + dk)]!;
          cornerVal[c] = v;
          // Our convention: f < 0 inside. Tables expect “inside” bits set.
          if (v < 0) cubeIndex |= 1 << c;
        }

        const edgeMask = EDGE_TABLE[cubeIndex]!;
        if (edgeMask === 0) continue;

        edgeVertIndex.fill(-1);
        for (let e = 0; e < 12; e++) {
          if ((edgeMask & (1 << e)) === 0) continue;
          const [c0, c1] = EDGE_INDEX[e]!;
          const [d0i, d0j, d0k] = CUBE_VERTS[c0]!;
          const [d1i, d1j, d1k] = CUBE_VERTS[c1]!;
          const a = cornerVal[c0]!;
          const b = cornerVal[c1]!;
          let t = 0;
          const d = a - b;
          if (Math.abs(d) > 1e-6) t = a / d;

          const x0 = box.min[0] + (i + d0i) * cell;
          const y0 = box.min[1] + (j + d0j) * cell;
          const z0 = box.min[2] + (k + d0k) * cell;
          const x1 = box.min[0] + (i + d1i) * cell;
          const y1 = box.min[1] + (j + d1j) * cell;
          const z1 = box.min[2] + (k + d1k) * cell;

          const vi = positions.length / 3;
          positions.push(
            x0 + t * (x1 - x0),
            y0 + t * (y1 - y0),
            z0 + t * (z1 - z0),
          );
          edgeVertIndex[e] = vi;
        }

        const tris = TRI_TABLE[cubeIndex]!;
        // Reverse winding vs Lysenko (positive-inside) so normals face outward.
        for (let t = 0; t < tris.length; t += 3) {
          const i0 = edgeVertIndex[tris[t]!]!;
          const i1 = edgeVertIndex[tris[t + 1]!]!;
          const i2 = edgeVertIndex[tris[t + 2]!]!;
          indices.push(i0, i2, i1);
        }
      }
    }
  }

  return weldMesh(
    new Float32Array(positions),
    new Uint32Array(indices),
  );
}

/**
 * Merge vertices that share the same quantized position so triangle
 * adjacency (and selection topology) sees true manifold edges.
 */
function weldMesh(
  positions: Float32Array,
  indices: Uint32Array,
  quant = 1e4, // 0.1 µm grid in mm units
): DerivedMesh {
  const map = new Map<string, number>();
  const outPos: number[] = [];
  const remap = new Int32Array(positions.length / 3);

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    const key = `${Math.round(x * quant)}_${Math.round(y * quant)}_${Math.round(z * quant)}`;
    let ni = map.get(key);
    if (ni === undefined) {
      ni = outPos.length / 3;
      map.set(key, ni);
      outPos.push(x, y, z);
    }
    remap[i / 3] = ni;
  }

  const outIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    outIdx[i] = remap[indices[i]!]!;
  }

  return {
    positions: new Float32Array(outPos),
    indices: outIdx,
  };
}
