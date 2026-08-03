/**
 * Field-native topology for selection (#15).
 *
 * Solid authority is the {@link FieldSolid}. The display mesh accelerates
 * hit-testing; entity identity comes from:
 * - **Solid**: field root on the mesh instance
 * - **Faces / regions**: CSG leaf id (`leafAt`) + connected planar/smooth patches
 *   separated by feature creases
 * - **Edges**: feature chains — multi-leaf junctions and/or dihedral creases
 * - **Vertices**: junctions only (degree ≠ 2, or sharp corners on a chain)
 */

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Vector3,
} from "three";
import { leafAt, type FieldSolid } from "../sdf";
import {
  makeEntityId,
  makeSolidEntityId,
  makeSolidId,
  type SelectionKind,
  type SelectionRef,
} from "./types";

/**
 * Dihedral angle (degrees) above which a same-leaf mesh edge is a feature crease.
 * Tuned for marching-cubes derivatives (stair-step noise on planes); multi-leaf
 * boundaries are always features regardless of this threshold.
 */
export const FEATURE_EDGE_DEGREES = 45;

/**
 * On a degree-2 feature vertex, if the chain turns by more than this many
 * degrees from straight, treat it as a corner (selectable vertex / edge split).
 * Smooth tessellation along a curve stays well below this.
 */
export const FEATURE_CORNER_DEGREES = 50;

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
  /** Ordered mesh vertex indices along the chain (start junction → end). */
  path: number[];
  /** World-space samples along the chain (same length as path). */
  points: Vector3[];
  /** Endpoints (path[0] / path[path.length-1]). */
  v0: number;
  v1: number;
  a: Vector3;
  b: Vector3;
}

export interface TopologyFace {
  localId: string;
  id: string;
  /**
   * CSG leaf / material that owns this region (`leafAt` on the field).
   * Stable across remeshing when generators keep leaf ids.
   */
  leafId?: string;
  /** Triangle indices (each triangle = 3 consecutive index-buffer corners / 3). */
  triangleIndices: number[];
  centroid: Vector3;
  normal: Vector3;
}

export interface SolidTopology {
  solidId: string;
  solidEntityId: string;
  mesh: Mesh;
  /** Authority field solid when available (from mesh.userData.fieldSolid). */
  field?: FieldSolid;
  faces: TopologyFace[];
  edges: TopologyEdge[];
  vertices: TopologyVertex[];
  /** Map triangle index → face array index. */
  triToFace: Int32Array;
  /** Map triangle index → CSG leaf id (empty string if unknown). */
  triLeaf: string[];
  /**
   * Pick helpers: concatenated segment endpoints for all topo edges
   * (2 verts × 3 floats per mesh segment along every chain).
   */
  edgePositions: Float32Array;
  /**
   * Parallel to edge segment index (edgePositions.length/6 entries):
   * maps each pick segment → topological edge index.
   */
  segmentToEdge: Int32Array;
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

function fieldFromMesh(mesh: Mesh): FieldSolid | undefined {
  const raw = mesh.userData?.fieldSolid;
  if (
    raw &&
    typeof raw === "object" &&
    typeof (raw as FieldSolid).evaluate === "function" &&
    (raw as FieldSolid).bounds
  ) {
    return raw as FieldSolid;
  }
  return undefined;
}

function buildSolidTopology(
  mesh: Mesh,
  meshIndex: number,
  featureDegrees: number,
): SolidTopology {
  const solidId = makeSolidId(mesh.name, meshIndex);
  const solidEntityId = makeSolidEntityId(solidId);
  const field = fieldFromMesh(mesh);
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute("position") as BufferAttribute;
  if (!pos) {
    return emptySolid(mesh, solidId, solidEntityId, field);
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

  // --- triangle normals + field leaf ownership ---
  const triNormals: Vector3[] = [];
  const triLeaf: string[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const centroid = new Vector3();

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

    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    // Nudge slightly outward so we sample just outside noisy zero-set interiors.
    centroid.addScaledVector(n, 0.05);
    const leaf = field
      ? leafAt(field, centroid.x, centroid.y, centroid.z) ?? ""
      : "";
    triLeaf.push(leaf);
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
    const t0 = rec.tris[0]!;
    const t1 = rec.tris[1]!;
    // Multi-leaf boundary is always a feature (field-native crease).
    if (triLeaf[t0] !== triLeaf[t1]) {
      featureKeys.add(key);
      continue;
    }
    const n0 = triNormals[t0]!;
    const n1 = triNormals[t1]!;
    // Dihedral crease approximates ∇f discontinuity on the derived mesh.
    if (n0.dot(n1) < cosThreshold) {
      featureKeys.add(key);
    }
  }

  // Triangle adjacency across non-feature edges (same leaf implied).
  const neighbors: number[][] = Array.from({ length: triCount }, () => []);
  for (const [key, rec] of edgeMap) {
    if (featureKeys.has(key)) continue;
    if (rec.tris.length !== 2) continue;
    const [t0, t1] = rec.tris;
    neighbors[t0!]!.push(t1!);
    neighbors[t1!]!.push(t0!);
  }

  // Face regions via flood fill (connected, same leaf, no feature boundary).
  const triToFace = new Int32Array(triCount).fill(-1);
  const faces: TopologyFace[] = [];
  const tmp = new Vector3();
  /** Per-leaf face counter for stable-ish local ids. */
  const leafFaceCount = new Map<string, number>();

  for (let seed = 0; seed < triCount; seed++) {
    if (triToFace[seed] !== -1) continue;
    const faceIndex = faces.length;
    const seedLeaf = triLeaf[seed] ?? "";
    const stack = [seed];
    triToFace[seed] = faceIndex;
    const tris: number[] = [];
    const faceCentroid = new Vector3();
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
      faceCentroid.add(a).add(b).add(c);
      normal.addScaledVector(triNormals[t]!, Math.max(area, 1e-12));
      areaWeight += 3; // three corners averaged

      for (const n of neighbors[t]!) {
        if (triToFace[n] !== -1) continue;
        // Defense: never merge across leaves even if feature detection missed.
        if ((triLeaf[n] ?? "") !== seedLeaf) continue;
        triToFace[n] = faceIndex;
        stack.push(n);
      }
    }

    if (areaWeight > 0) faceCentroid.multiplyScalar(1 / areaWeight);
    if (normal.lengthSq() > 1e-20) normal.normalize();
    else normal.set(0, 0, 1);

    const leafKey = seedLeaf || "_";
    const nInLeaf = leafFaceCount.get(leafKey) ?? 0;
    leafFaceCount.set(leafKey, nInLeaf + 1);
    const localId = seedLeaf
      ? `leaf:${seedLeaf}/f${nInLeaf}`
      : `f${faceIndex}`;
    faces.push({
      localId,
      id: makeEntityId("face", solidId, localId),
      leafId: seedLeaf || undefined,
      triangleIndices: tris,
      centroid: faceCentroid,
      normal,
    });
  }

  // Feature *chains* (CAD edges) + junction vertices only.
  const { edges, vertices, edgePositions, segmentToEdge, vertexPositions } =
    chainFeatureEdges({
      featureKeys,
      edgeMap,
      getWorldPos,
      solidId,
      cornerDegrees: FEATURE_CORNER_DEGREES,
    });

  return {
    solidId,
    solidEntityId,
    mesh,
    field,
    faces,
    edges,
    vertices,
    triToFace,
    triLeaf,
    edgePositions,
    segmentToEdge,
    vertexPositions,
    edgeByIndex: edges,
    vertexByIndex: vertices,
  };
}

type EdgeRec = { v0: number; v1: number; tris: number[] };

/**
 * Collapse feature mesh segments into topological edges (polylines between
 * junctions) and keep only junction vertices for selection.
 */
function chainFeatureEdges(args: {
  featureKeys: Set<string>;
  edgeMap: Map<string, EdgeRec>;
  getWorldPos: (vertexIndex: number, target: Vector3) => Vector3;
  solidId: string;
  cornerDegrees: number;
}): {
  edges: TopologyEdge[];
  vertices: TopologyVertex[];
  edgePositions: Float32Array;
  segmentToEdge: Int32Array;
  vertexPositions: Float32Array;
} {
  const { featureKeys, edgeMap, getWorldPos, solidId, cornerDegrees } = args;

  // Adjacency: mesh vertex → list of (neighbor, undirected edge key).
  type Adj = { other: number; key: string };
  const adj = new Map<number, Adj[]>();
  for (const key of featureKeys) {
    const rec = edgeMap.get(key)!;
    const a = rec.v0;
    const b = rec.v1;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ other: b, key });
    adj.get(b)!.push({ other: a, key });
  }

  const posCache = new Map<number, Vector3>();
  const worldPos = (vi: number): Vector3 => {
    let p = posCache.get(vi);
    if (!p) {
      p = new Vector3();
      getWorldPos(vi, p);
      posCache.set(vi, p);
    }
    return p;
  };

  const cosCorner = Math.cos((cornerDegrees * Math.PI) / 180);
  const d0 = new Vector3();
  const d1 = new Vector3();

  const isJunction = (vi: number): boolean => {
    const nbrs = adj.get(vi);
    if (!nbrs || nbrs.length !== 2) return true;
    // Degree 2: smooth chain iff the two segments are nearly collinear (opposite).
    // d0/d1 = unit vectors from vi toward each neighbor; straight ⇒ d0·d1 ≈ -1.
    const p = worldPos(vi);
    d0.subVectors(worldPos(nbrs[0]!.other), p);
    d1.subVectors(worldPos(nbrs[1]!.other), p);
    if (d0.lengthSq() < 1e-20 || d1.lengthSq() < 1e-20) return true;
    d0.normalize();
    d1.normalize();
    // Junction when turn from straight exceeds cornerDegrees.
    return d0.dot(d1) > -cosCorner;
  };

  const junctionSet = new Set<number>();
  for (const vi of adj.keys()) {
    if (isJunction(vi)) junctionSet.add(vi);
  }

  const visitedKeys = new Set<string>();
  const edges: TopologyEdge[] = [];
  const segmentPairs: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; edgeIndex: number }[] = [];

  const pushEdgeFromPath = (path: number[]): void => {
    if (path.length < 2) return;
    const points = path.map((vi) => worldPos(vi).clone());
    const localId = `e${edges.length}`;
    const edgeIndex = edges.length;
    edges.push({
      localId,
      id: makeEntityId("edge", solidId, localId),
      path: path.slice(),
      points,
      v0: path[0]!,
      v1: path[path.length - 1]!,
      a: points[0]!.clone(),
      b: points[points.length - 1]!.clone(),
    });
    for (let i = 0; i < points.length - 1; i++) {
      const A = points[i]!;
      const B = points[i + 1]!;
      segmentPairs.push({
        ax: A.x,
        ay: A.y,
        az: A.z,
        bx: B.x,
        by: B.y,
        bz: B.z,
        edgeIndex,
      });
    }
  };

  const walkChain = (start: number, firstOther: number, firstKey: string): void => {
    if (visitedKeys.has(firstKey)) return;
    const path = [start];
    let prev = start;
    let curr = firstOther;
    let key = firstKey;
    visitedKeys.add(key);

    while (true) {
      path.push(curr);
      if (junctionSet.has(curr) && path.length > 1) break;

      const nbrs = adj.get(curr) ?? [];
      let next: Adj | null = null;
      for (const n of nbrs) {
        if (n.other === prev) continue;
        if (visitedKeys.has(n.key)) continue;
        next = n;
        break;
      }
      // Closed loop or dead-end mid-chain.
      if (!next) break;
      prev = curr;
      curr = next.other;
      key = next.key;
      visitedKeys.add(key);

      // Safety: avoid infinite loops on malformed adjacency.
      if (path.length > adj.size + 2) break;
    }

    pushEdgeFromPath(path);
  };

  // Start a chain from every unused feature segment leaving a junction.
  const junctionList = [...junctionSet].sort((a, b) => a - b);
  for (const start of junctionList) {
    for (const n of adj.get(start) ?? []) {
      if (visitedKeys.has(n.key)) continue;
      walkChain(start, n.other, n.key);
    }
  }

  // Closed loops (or remaining chains) with no junctions.
  for (const key of featureKeys) {
    if (visitedKeys.has(key)) continue;
    const rec = edgeMap.get(key)!;
    walkChain(rec.v0, rec.v1, key);
  }

  // Selectable vertices = junctions that actually touch a feature chain.
  const vertices: TopologyVertex[] = [];
  for (const vertexIndex of junctionList) {
    if ((adj.get(vertexIndex)?.length ?? 0) === 0) continue;
    const localId = `v${vertices.length}`;
    vertices.push({
      localId,
      id: makeEntityId("vertex", solidId, localId),
      vertexIndex,
      position: worldPos(vertexIndex).clone(),
    });
  }

  const edgePositions = new Float32Array(segmentPairs.length * 6);
  const segmentToEdge = new Int32Array(segmentPairs.length);
  segmentPairs.forEach((seg, i) => {
    const o = i * 6;
    edgePositions[o] = seg.ax;
    edgePositions[o + 1] = seg.ay;
    edgePositions[o + 2] = seg.az;
    edgePositions[o + 3] = seg.bx;
    edgePositions[o + 4] = seg.by;
    edgePositions[o + 5] = seg.bz;
    segmentToEdge[i] = seg.edgeIndex;
  });

  const vertexPositions = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    const o = i * 3;
    vertexPositions[o] = v.position.x;
    vertexPositions[o + 1] = v.position.y;
    vertexPositions[o + 2] = v.position.z;
  });

  return { edges, vertices, edgePositions, segmentToEdge, vertexPositions };
}

function emptySolid(
  mesh: Mesh,
  solidId: string,
  solidEntityId: string,
  field?: FieldSolid,
): SolidTopology {
  return {
    solidId,
    solidEntityId,
    mesh,
    field,
    faces: [],
    edges: [],
    vertices: [],
    triToFace: new Int32Array(0),
    triLeaf: [],
    edgePositions: new Float32Array(0),
    segmentToEdge: new Int32Array(0),
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
