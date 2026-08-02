/**
 * Mesh-derived topology for selection.
 *
 * Manifold (and most mesh kernels) do not give B-rep faces/edges. We recover
 * CAD-ish entities from the triangle mesh:
 * - **Faces**: connected triangle regions separated by feature edges (dihedral).
 * - **Edges**: feature / boundary edges only.
 * - **Vertices**: endpoints of feature edges (corners and crease junctions).
 * - **Solid**: the whole mesh.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Vector3,
} from "three";
import {
  makeEntityId,
  makeSolidEntityId,
  makeSolidId,
  type SelectionKind,
  type SelectionRef,
} from "./types";

/** Dihedral angle (degrees) above which an edge is a feature boundary. */
export const FEATURE_EDGE_DEGREES = 20;

export interface TopologyVertex {
  localId: string;
  id: string;
  /** Index into the mesh position attribute. */
  vertexIndex: number;
  position: Vector3;
}

export interface TopologyEdge {
  localId: string;
  id: string;
  v0: number;
  v1: number;
  a: Vector3;
  b: Vector3;
}

export interface TopologyFace {
  localId: string;
  id: string;
  /** Triangle indices (each triangle = 3 consecutive index-buffer corners / 3). */
  triangleIndices: number[];
  centroid: Vector3;
  normal: Vector3;
}

export interface SolidTopology {
  solidId: string;
  solidEntityId: string;
  mesh: Mesh;
  faces: TopologyFace[];
  edges: TopologyEdge[];
  vertices: TopologyVertex[];
  /** Map triangle index → face array index. */
  triToFace: Int32Array;
  /** Pick helpers (world-space positions baked at build time; mesh should be static). */
  edgePositions: Float32Array;
  vertexPositions: Float32Array;
  /** edge local index → TopologyEdge */
  edgeByIndex: TopologyEdge[];
  vertexByIndex: TopologyVertex[];
}

export interface TopologyIndex {
  solids: SolidTopology[];
  byEntityId: Map<string, { solid: SolidTopology; kind: SelectionKind; localIndex: number }>;
}

export function buildTopologyIndex(
  meshes: readonly Mesh[],
  featureDegrees: number = FEATURE_EDGE_DEGREES,
): TopologyIndex {
  const solids: SolidTopology[] = [];
  const byEntityId = new Map<
    string,
    { solid: SolidTopology; kind: SelectionKind; localIndex: number }
  >();

  meshes.forEach((mesh, meshIndex) => {
    const solid = buildSolidTopology(mesh, meshIndex, featureDegrees);
    solids.push(solid);

    byEntityId.set(solid.solidEntityId, {
      solid,
      kind: "solid",
      localIndex: 0,
    });
    solid.faces.forEach((f, i) => {
      byEntityId.set(f.id, { solid, kind: "face", localIndex: i });
    });
    solid.edges.forEach((e, i) => {
      byEntityId.set(e.id, { solid, kind: "edge", localIndex: i });
    });
    solid.vertices.forEach((v, i) => {
      byEntityId.set(v.id, { solid, kind: "vertex", localIndex: i });
    });
  });

  return { solids, byEntityId };
}

export function refFromTopology(
  solid: SolidTopology,
  kind: SelectionKind,
  localIndex: number,
): SelectionRef {
  if (kind === "solid") {
    return {
      kind: "solid",
      id: solid.solidEntityId,
      solidId: solid.solidId,
      label: solid.mesh.name || solid.solidId,
      geometry: {
        kind: "solid",
        centroid: solidCentroid(solid),
      },
    };
  }
  if (kind === "face") {
    const face = solid.faces[localIndex]!;
    return {
      kind: "face",
      id: face.id,
      solidId: solid.solidId,
      geometry: {
        kind: "face",
        centroid: face.centroid.clone(),
        normal: face.normal.clone(),
      },
    };
  }
  if (kind === "edge") {
    const edge = solid.edges[localIndex]!;
    return {
      kind: "edge",
      id: edge.id,
      solidId: solid.solidId,
      geometry: {
        kind: "edge",
        a: edge.a.clone(),
        b: edge.b.clone(),
      },
    };
  }
  const vertex = solid.vertices[localIndex]!;
  return {
    kind: "vertex",
    id: vertex.id,
    solidId: solid.solidId,
    geometry: {
      kind: "vertex",
      position: vertex.position.clone(),
    },
  };
}

function solidCentroid(solid: SolidTopology): Vector3 {
  const c = new Vector3();
  let n = 0;
  for (const f of solid.faces) {
    c.add(f.centroid);
    n++;
  }
  if (n > 0) c.multiplyScalar(1 / n);
  return c;
}

function buildSolidTopology(
  mesh: Mesh,
  meshIndex: number,
  featureDegrees: number,
): SolidTopology {
  const solidId = makeSolidId(mesh.name, meshIndex);
  const solidEntityId = makeSolidEntityId(solidId);
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute("position") as BufferAttribute;
  if (!pos) {
    return emptySolid(mesh, solidId, solidEntityId);
  }

  // Work in local mesh space; demos are untransformed. Apply mesh matrix later if needed.
  mesh.updateWorldMatrix(true, false);
  const world = mesh.matrixWorld;

  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;
  const getTriVertex = (tri: number, corner: number): number => {
    if (index) return index.getX(tri * 3 + corner);
    return tri * 3 + corner;
  };

  const getWorldPos = (vertexIndex: number, target: Vector3): Vector3 => {
    target.fromBufferAttribute(pos, vertexIndex).applyMatrix4(world);
    return target;
  };

  // --- triangle normals ---
  const triNormals: Vector3[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = getTriVertex(t, 0);
    const i1 = getTriVertex(t, 1);
    const i2 = getTriVertex(t, 2);
    getWorldPos(i0, a);
    getWorldPos(i1, b);
    getWorldPos(i2, c);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const n = new Vector3().crossVectors(ab, ac);
    if (n.lengthSq() > 1e-20) n.normalize();
    else n.set(0, 0, 1);
    triNormals.push(n);
  }

  // --- edges: key → { v0, v1, tris[] } ---
  type EdgeRec = { v0: number; v1: number; tris: number[] };
  const edgeMap = new Map<string, EdgeRec>();

  const edgeKey = (i: number, j: number): string =>
    i < j ? `${i}_${j}` : `${j}_${i}`;

  const addEdge = (i: number, j: number, tri: number): void => {
    const key = edgeKey(i, j);
    let rec = edgeMap.get(key);
    if (!rec) {
      rec = { v0: Math.min(i, j), v1: Math.max(i, j), tris: [] };
      edgeMap.set(key, rec);
    }
    rec.tris.push(tri);
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = getTriVertex(t, 0);
    const i1 = getTriVertex(t, 1);
    const i2 = getTriVertex(t, 2);
    addEdge(i0, i1, t);
    addEdge(i1, i2, t);
    addEdge(i2, i0, t);
  }

  const cosThreshold = Math.cos((featureDegrees * Math.PI) / 180);
  const featureKeys = new Set<string>();

  for (const [key, rec] of edgeMap) {
    if (rec.tris.length !== 2) {
      featureKeys.add(key);
      continue;
    }
    const n0 = triNormals[rec.tris[0]!]!;
    const n1 = triNormals[rec.tris[1]!]!;
    // Feature when normals diverge beyond threshold (dihedral crease).
    if (n0.dot(n1) < cosThreshold) {
      featureKeys.add(key);
    }
  }

  // Triangle adjacency across non-feature edges.
  const neighbors: number[][] = Array.from({ length: triCount }, () => []);
  for (const [key, rec] of edgeMap) {
    if (featureKeys.has(key)) continue;
    if (rec.tris.length !== 2) continue;
    const [t0, t1] = rec.tris;
    neighbors[t0!]!.push(t1!);
    neighbors[t1!]!.push(t0!);
  }

  // Face regions via flood fill.
  const triToFace = new Int32Array(triCount).fill(-1);
  const faces: TopologyFace[] = [];
  const tmp = new Vector3();

  for (let seed = 0; seed < triCount; seed++) {
    if (triToFace[seed] !== -1) continue;
    const faceIndex = faces.length;
    const stack = [seed];
    triToFace[seed] = faceIndex;
    const tris: number[] = [];
    const centroid = new Vector3();
    const normal = new Vector3();
    let areaWeight = 0;

    while (stack.length > 0) {
      const t = stack.pop()!;
      tris.push(t);
      const i0 = getTriVertex(t, 0);
      const i1 = getTriVertex(t, 1);
      const i2 = getTriVertex(t, 2);
      getWorldPos(i0, a);
      getWorldPos(i1, b);
      getWorldPos(i2, c);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      const cross = tmp.crossVectors(ab, ac);
      const area = cross.length() * 0.5;
      centroid.add(a).add(b).add(c);
      normal.addScaledVector(triNormals[t]!, Math.max(area, 1e-12));
      areaWeight += 3; // three corners averaged

      for (const n of neighbors[t]!) {
        if (triToFace[n] === -1) {
          triToFace[n] = faceIndex;
          stack.push(n);
        }
      }
    }

    if (areaWeight > 0) centroid.multiplyScalar(1 / areaWeight);
    if (normal.lengthSq() > 1e-20) normal.normalize();
    else normal.set(0, 0, 1);

    const localId = `f${faceIndex}`;
    faces.push({
      localId,
      id: makeEntityId("face", solidId, localId),
      triangleIndices: tris,
      centroid,
      normal,
    });
  }

  // Feature edges + vertices.
  const edges: TopologyEdge[] = [];
  const vertexIndexSet = new Set<number>();
  const p0 = new Vector3();
  const p1 = new Vector3();

  for (const key of featureKeys) {
    const rec = edgeMap.get(key)!;
    getWorldPos(rec.v0, p0);
    getWorldPos(rec.v1, p1);
    const localId = `e${edges.length}`;
    edges.push({
      localId,
      id: makeEntityId("edge", solidId, localId),
      v0: rec.v0,
      v1: rec.v1,
      a: p0.clone(),
      b: p1.clone(),
    });
    vertexIndexSet.add(rec.v0);
    vertexIndexSet.add(rec.v1);
  }

  const vertices: TopologyVertex[] = [];
  const sortedVerts = [...vertexIndexSet].sort((x, y) => x - y);
  for (const vertexIndex of sortedVerts) {
    const localId = `v${vertices.length}`;
    const position = new Vector3();
    getWorldPos(vertexIndex, position);
    vertices.push({
      localId,
      id: makeEntityId("vertex", solidId, localId),
      vertexIndex,
      position,
    });
  }

  const edgePositions = new Float32Array(edges.length * 6);
  edges.forEach((e, i) => {
    const o = i * 6;
    edgePositions[o] = e.a.x;
    edgePositions[o + 1] = e.a.y;
    edgePositions[o + 2] = e.a.z;
    edgePositions[o + 3] = e.b.x;
    edgePositions[o + 4] = e.b.y;
    edgePositions[o + 5] = e.b.z;
  });

  const vertexPositions = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    const o = i * 3;
    vertexPositions[o] = v.position.x;
    vertexPositions[o + 1] = v.position.y;
    vertexPositions[o + 2] = v.position.z;
  });

  return {
    solidId,
    solidEntityId,
    mesh,
    faces,
    edges,
    vertices,
    triToFace,
    edgePositions,
    vertexPositions,
    edgeByIndex: edges,
    vertexByIndex: vertices,
  };
}

function emptySolid(
  mesh: Mesh,
  solidId: string,
  solidEntityId: string,
): SolidTopology {
  return {
    solidId,
    solidEntityId,
    mesh,
    faces: [],
    edges: [],
    vertices: [],
    triToFace: new Int32Array(0),
    edgePositions: new Float32Array(0),
    vertexPositions: new Float32Array(0),
    edgeByIndex: [],
    vertexByIndex: [],
  };
}

/** Build a BufferGeometry containing only the triangles of a face (world space). */
export function faceHighlightGeometry(
  solid: SolidTopology,
  face: TopologyFace,
): BufferGeometry {
  const mesh = solid.mesh;
  const src = mesh.geometry;
  const pos = src.getAttribute("position") as BufferAttribute;
  const index = src.getIndex();
  const world = mesh.matrixWorld;

  const positions = new Float32Array(face.triangleIndices.length * 9);
  const tmp = new Vector3();
  let w = 0;

  for (const t of face.triangleIndices) {
    for (let c = 0; c < 3; c++) {
      const vi = index ? index.getX(t * 3 + c) : t * 3 + c;
      tmp.fromBufferAttribute(pos, vi).applyMatrix4(world);
      positions[w++] = tmp.x;
      positions[w++] = tmp.y;
      positions[w++] = tmp.z;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Full solid mesh positions in world space (non-indexed) for overlay. */
export function solidHighlightGeometry(solid: SolidTopology): BufferGeometry {
  const mesh = solid.mesh;
  const src = mesh.geometry;
  const pos = src.getAttribute("position") as BufferAttribute;
  const index = src.getIndex();
  const world = mesh.matrixWorld;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const positions = new Float32Array(triCount * 9);
  const tmp = new Vector3();
  let w = 0;

  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const vi = index ? index.getX(t * 3 + c) : t * 3 + c;
      tmp.fromBufferAttribute(pos, vi).applyMatrix4(world);
      positions[w++] = tmp.x;
      positions[w++] = tmp.y;
      positions[w++] = tmp.z;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
