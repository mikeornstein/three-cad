/**
 * Field-native topology for selection (#15).
 *
 * Solid authority is the {@link FieldSolid}. The display mesh accelerates
 * hit-testing; entity identity comes from:
 * - **Solid**: field root on the mesh instance
 * - **Faces**: CSG leaf + axis buckets on faceted leaves (cube), one curved
 *   region on smooth leaves (sphere). Field gradients preferred over mesh normals.
 * - **Edges**: one polyline per face-pair boundary (two faces meet), straightened
 *   when nearly linear so MC stairs don’t split or double edges
 * - **Vertices**: endpoints of topo edges, spatially welded
 */

import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Vector3,
} from "three";
import {
  exactFeatures,
  fieldNormal,
  leafAt,
  type ExactEdge,
  type ExactFeatureSet,
  type FieldSolid,
} from "../sdf";
import {
  makeEntityId,
  makeSolidEntityId,
  makeSolidId,
  type SelectionKind,
  type SelectionRef,
} from "./types";

/**
 * Legacy dihedral threshold (mesh-only fallback when no field is attached).
 * Field-backed solids use face-first classification instead (see buildSolidTopology).
 */
export const FEATURE_EDGE_DEGREES = 40;

/**
 * Optional: split degree-2 feature chains when the polyline turns harder than
 * this (degrees from straight). Default is disabled (null) so MC stair-steps
 * and curved multi-leaf loops stay one edge; only valence ≠ 2 splits chains.
 * Set a number (e.g. 70) to re-enable geometric corner splits.
 */
export const FEATURE_CORNER_DEGREES: number | null = null;

/** Nudge (mm) along normal when sampling the field at a triangle centroid. */
const SAMPLE_NUDGE_MM = 0.35;

/**
 * |n_axis| above this → triangle is “planar/axis” for face bucketing.
 * Below → curved (sphere-like); stays one region per leaf.
 */
const AXIS_FACE_DOT = 0.9;

export interface TopologyVertex {
  localId: string;
  id: string;
  /** Index into the mesh position attribute (−1 if exact-only). */
  vertexIndex: number;
  position: Vector3;
  /** True when position comes from constructive field features. */
  exact?: boolean;
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
  /**
   * Authority length in mm. When set from constructive field source, this is
   * exact (not polyline-sampled). Prefer this over summing `points`.
   */
  length?: number;
  /** True when a/b/length come from exact field features. */
  exact?: boolean;
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
  /**
   * Field-measured area (mm²) when available — not mesh triangle sum.
   * Filled lazily by measure / tests via {@link attachFieldFaceMetrics}.
   */
  area?: number;
  /** True when area/centroid/normal were refined from the field. */
  exact?: boolean;
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

/** Bucket a unit normal into a planar axis face or "curved". */
function axisFaceBucket(n: Vector3): string {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const m = Math.max(ax, ay, az);
  if (m < AXIS_FACE_DOT) return "curved";
  if (ax === m) return n.x >= 0 ? "+x" : "-x";
  if (ay === m) return n.y >= 0 ? "+y" : "-y";
  return n.z >= 0 ? "+z" : "-z";
}

/** Leaves whose tris are mostly axis-aligned → split into planar faces. */
function detectFacetedLeaves(
  triLeaf: string[],
  triBucket: string[],
): Set<string> {
  const totals = new Map<string, number>();
  const axis = new Map<string, number>();
  for (let i = 0; i < triLeaf.length; i++) {
    const leaf = triLeaf[i] ?? "";
    totals.set(leaf, (totals.get(leaf) ?? 0) + 1);
    if (triBucket[i] !== "curved") {
      axis.set(leaf, (axis.get(leaf) ?? 0) + 1);
    }
  }
  const faceted = new Set<string>();
  for (const [leaf, n] of totals) {
    if (n > 0 && (axis.get(leaf) ?? 0) / n >= 0.45) faceted.add(leaf);
  }
  return faceted;
}

/**
 * MC ramps between cube faces have "curved" buckets. Fold them into the
 * majority planar neighbor (same leaf) so +x/+z stay separate faces but
 * corner fillets don't become their own selectable patches.
 */
function absorbCurvedIntoPlanarBuckets(
  triLeaf: string[],
  triBucket: string[],
  neighbors: number[][],
  facetedLeaves: Set<string>,
): void {
  const triCount = triBucket.length;
  let changed = true;
  while (changed) {
    changed = false;
    for (let t = 0; t < triCount; t++) {
      if (triBucket[t] !== "curved") continue;
      const leaf = triLeaf[t] ?? "";
      if (!facetedLeaves.has(leaf)) continue;
      const votes = new Map<string, number>();
      for (const n of neighbors[t]!) {
        if ((triLeaf[n] ?? "") !== leaf) continue;
        const b = triBucket[n]!;
        if (b === "curved") continue;
        votes.set(b, (votes.get(b) ?? 0) + 1);
      }
      if (votes.size === 0) continue;
      let best = "";
      let bestN = -1;
      for (const [b, c] of votes) {
        if (c > bestN) {
          best = b;
          bestN = c;
        }
      }
      if (best) {
        triBucket[t] = best;
        changed = true;
      }
    }
  }
}

/**
 * Merge faces with fewer than minTris into the largest adjacent same-leaf face.
 * Updates `faces` and `triToFace` in place (ids of survivors preserved).
 */
function mergeTinyFaces(
  faces: TopologyFace[],
  triToFace: Int32Array,
  neighbors: number[][],
  triLeaf: string[],
  minTris: number,
): void {
  if (faces.length === 0) return;

  const absorb = new Int32Array(faces.length).fill(-1);
  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]!;
    if (face.triangleIndices.length >= minTris) continue;
    const leaf = face.leafId ?? "";
    const votes = new Map<number, number>();
    for (const t of face.triangleIndices) {
      for (const n of neighbors[t]!) {
        const nf = triToFace[n]!;
        if (nf < 0 || nf === fi) continue;
        if ((triLeaf[n] ?? "") !== leaf && leaf !== "") continue;
        if (faces[nf]!.triangleIndices.length < minTris) continue;
        votes.set(nf, (votes.get(nf) ?? 0) + 1);
      }
    }
    let best = -1;
    let bestN = -1;
    for (const [nf, c] of votes) {
      if (c > bestN) {
        best = nf;
        bestN = c;
      }
    }
    if (best >= 0) absorb[fi] = best;
  }

  const resolve = (fi: number): number => {
    let cur = fi;
    const seen = new Set<number>();
    while (absorb[cur]! >= 0 && !seen.has(cur)) {
      seen.add(cur);
      cur = absorb[cur]!;
    }
    return cur;
  };

  const groups = new Map<number, number[]>();
  for (let fi = 0; fi < faces.length; fi++) {
    const root = resolve(fi);
    let list = groups.get(root);
    if (!list) {
      list = [];
      groups.set(root, list);
    }
    list.push(fi);
  }

  const newFaces: TopologyFace[] = [];
  const oldToNew = new Int32Array(faces.length).fill(-1);

  for (const [root, members] of groups) {
    const survivor = faces[root]!;
    const tris: number[] = [];
    for (const m of members) {
      tris.push(...faces[m]!.triangleIndices);
    }
    const ni = newFaces.length;
    for (const m of members) oldToNew[m] = ni;
    newFaces.push({
      localId: survivor.localId,
      id: survivor.id,
      leafId: survivor.leafId,
      triangleIndices: tris,
      centroid: survivor.centroid.clone(),
      normal: survivor.normal.clone(),
    });
  }

  faces.length = 0;
  faces.push(...newFaces);
  triToFace.fill(-1);
  faces.forEach((f, i) => {
    for (const t of f.triangleIndices) triToFace[t] = i;
  });
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

  // --- per-triangle leaf + surface normal (field gradient preferred) ---
  const triNormals: Vector3[] = [];
  const triLeaf: string[] = [];
  const triCentroid: Vector3[] = [];
  /** Axis face bucket: "+x"|"-x"|… or "curved" for organic patches. */
  const triBucket: string[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const meshNormal = new Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = getTriVertex(t, 0);
    const i1 = getTriVertex(t, 1);
    const i2 = getTriVertex(t, 2);
    getWorldPos(i0, a);
    getWorldPos(i1, b);
    getWorldPos(i2, c);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    meshNormal.crossVectors(ab, ac);
    if (meshNormal.lengthSq() > 1e-20) meshNormal.normalize();
    else meshNormal.set(0, 0, 1);

    const centroid = new Vector3().copy(a).add(b).add(c).multiplyScalar(1 / 3);
    centroid.addScaledVector(meshNormal, SAMPLE_NUDGE_MM);
    triCentroid.push(centroid);

    let leaf = "";
    let normal = meshNormal.clone();
    if (field) {
      leaf = leafAt(field, centroid.x, centroid.y, centroid.z) ?? "";
      const gn = fieldNormal(field, centroid.x, centroid.y, centroid.z);
      if (gn) {
        normal = new Vector3(gn[0], gn[1], gn[2]);
        if (normal.dot(meshNormal) < 0) normal.negate();
      }
    }
    triLeaf.push(leaf);
    triNormals.push(normal);
    triBucket.push(axisFaceBucket(normal));
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

  // Full adjacency (manifold edges only) — face-first classification decides features.
  const neighbors: number[][] = Array.from({ length: triCount }, () => []);
  for (const rec of edgeMap.values()) {
    if (rec.tris.length !== 2) continue;
    const [t0, t1] = rec.tris;
    neighbors[t0!]!.push(t1!);
    neighbors[t1!]!.push(t0!);
  }

  // Axis bucketing only for faceted leaves (majority planar normals).
  // Smooth leaves (sphere) stay a single "curved" region per connected component.
  const facetedLeaves = detectFacetedLeaves(triLeaf, triBucket);
  for (let t = 0; t < triCount; t++) {
    const leaf = triLeaf[t] ?? "";
    if (!facetedLeaves.has(leaf)) {
      triBucket[t] = "curved";
    }
  }

  // Absorb MC ramps on faceted leaves into neighboring planar buckets.
  absorbCurvedIntoPlanarBuckets(triLeaf, triBucket, neighbors, facetedLeaves);

  // Face regions: same leaf + same bucket, connected.
  // Faceted cube → six axis faces; smooth sphere → one curved face.
  const triToFace = new Int32Array(triCount).fill(-1);
  const faces: TopologyFace[] = [];
  const tmp = new Vector3();
  const leafFaceCount = new Map<string, number>();

  for (let seed = 0; seed < triCount; seed++) {
    if (triToFace[seed] !== -1) continue;
    const faceIndex = faces.length;
    const seedLeaf = triLeaf[seed] ?? "";
    const seedBucket = triBucket[seed] ?? "curved";
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
      faceCentroid.add(triCentroid[t]!);
      normal.addScaledVector(triNormals[t]!, Math.max(area, 1e-12));
      areaWeight += 1;

      for (const n of neighbors[t]!) {
        if (triToFace[n] !== -1) continue;
        if ((triLeaf[n] ?? "") !== seedLeaf) continue;
        if ((triBucket[n] ?? "curved") !== seedBucket) continue;
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
    const bucketPart =
      seedBucket !== "curved" ? `/${seedBucket}` : "";
    const localId = seedLeaf
      ? `leaf:${seedLeaf}${bucketPart}/f${nInLeaf}`
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

  // Merge tiny island faces into largest adjacent same-leaf face (MC noise).
  mergeTinyFaces(faces, triToFace, neighbors, triLeaf, 8);

  // Feature edges = boundaries between different faces (or multi-leaf).
  // This avoids double parallel MC-stair edges: only true face/face creases.
  const featureKeys = new Set<string>();
  const cosFallback = Math.cos((featureDegrees * Math.PI) / 180);

  for (const [key, rec] of edgeMap) {
    if (rec.tris.length !== 2) continue;
    const t0 = rec.tris[0]!;
    const t1 = rec.tris[1]!;
    if (triLeaf[t0] !== triLeaf[t1]) {
      featureKeys.add(key);
      continue;
    }
    if (triToFace[t0] !== triToFace[t1]) {
      featureKeys.add(key);
      continue;
    }
    // Mesh-only fallback: dihedral inside a face (should be rare).
    if (!field && triNormals[t0]!.dot(triNormals[t1]!) < cosFallback) {
      featureKeys.add(key);
    }
  }

  // Feature *chains* = one edge per face-pair (mesh accel for picking).
  let { edges, vertices, edgePositions, segmentToEdge, vertexPositions } =
    chainFeatureEdgesByFacePair({
      featureKeys,
      edgeMap,
      triToFace,
      getWorldPos,
      solidId,
    });

  // Prefer constructive exact features for vertex positions + edge lengths.
  if (field) {
    const exact = exactFeatures(field);
    if (exact && exact.edges.length > 0) {
      const refined = topologyFromExactFeatures(exact, solidId);
      edges = refined.edges;
      vertices = refined.vertices;
      edgePositions = refined.edgePositions;
      segmentToEdge = refined.segmentToEdge;
      vertexPositions = refined.vertexPositions;
    }
  }

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

/**
 * Build selection edges/vertices directly from exact field features.
 * Face regions still come from the mesh; pick helpers use exact polylines.
 */
function topologyFromExactFeatures(
  exact: ExactFeatureSet,
  solidId: string,
): {
  edges: TopologyEdge[];
  vertices: TopologyVertex[];
  edgePositions: Float32Array;
  segmentToEdge: Int32Array;
  vertexPositions: Float32Array;
} {
  const vertices: TopologyVertex[] = exact.vertices.map((v, i) => {
    const localId = `v${i}`;
    return {
      localId,
      id: makeEntityId("vertex", solidId, localId),
      vertexIndex: -1,
      position: new Vector3(v.position[0], v.position[1], v.position[2]),
      exact: true,
    };
  });

  const edges: TopologyEdge[] = [];
  const segmentPairs: {
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    edgeIndex: number;
  }[] = [];

  for (const e of exact.edges) {
    const points = sampleExactEdge(e);
    if (points.length < 2) continue;
    const localId = `e${edges.length}`;
    const edgeIndex = edges.length;
    edges.push({
      localId,
      id: makeEntityId("edge", solidId, localId),
      path: [],
      points,
      v0: -1,
      v1: -1,
      a: points[0]!.clone(),
      b: points[points.length - 1]!.clone(),
      length: e.length,
      exact: true,
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

/** Dense samples for highlight/pick; length stays on ExactEdge. */
function sampleExactEdge(e: ExactEdge): Vector3[] {
  if (e.kind === "line") {
    return [
      new Vector3(e.a[0], e.a[1], e.a[2]),
      new Vector3(e.b[0], e.b[1], e.b[2]),
    ];
  }
  const c = new Vector3(e.center[0], e.center[1], e.center[2]);
  const from = new Vector3(e.a[0], e.a[1], e.a[2]).sub(c);
  const to = new Vector3(e.b[0], e.b[1], e.b[2]).sub(c);
  const u = from.clone().normalize();
  let w = new Vector3().crossVectors(from, to);
  if (w.lengthSq() < 1e-20) {
    w =
      Math.abs(u.x) < 0.9
        ? new Vector3().crossVectors(u, new Vector3(1, 0, 0))
        : new Vector3().crossVectors(u, new Vector3(0, 1, 0));
  }
  w.normalize();
  let v = new Vector3().crossVectors(w, u).normalize();
  // Orient v so sweeping +angle reaches `to`.
  const toN = to.clone().normalize();
  if (toN.dot(v) < 0) v.negate();

  const angle = e.angle;
  const steps = Math.max(8, Math.ceil((angle / (Math.PI / 2)) * 32));
  const pts: Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * angle;
    pts.push(
      c
        .clone()
        .addScaledVector(u, e.radius * Math.cos(t))
        .addScaledVector(v, e.radius * Math.sin(t)),
    );
  }
  pts[0]!.set(e.a[0], e.a[1], e.a[2]);
  pts[pts.length - 1]!.set(e.b[0], e.b[1], e.b[2]);
  return pts;
}

type EdgeRec = { v0: number; v1: number; tris: number[] };
type FeatureAdj = { other: number; key: string };

/**
 * Collapse feature mesh segments into topological edges by **face pair**.
 * An edge is the boundary between two faces (CAD model). Chains stay within
 * one face-pair so cube corners split edges and curved face∩face arcs stay whole.
 */
function chainFeatureEdgesByFacePair(args: {
  featureKeys: Set<string>;
  edgeMap: Map<string, EdgeRec>;
  triToFace: Int32Array;
  getWorldPos: (vertexIndex: number, target: Vector3) => Vector3;
  solidId: string;
}): {
  edges: TopologyEdge[];
  vertices: TopologyVertex[];
  edgePositions: Float32Array;
  segmentToEdge: Int32Array;
  vertexPositions: Float32Array;
} {
  const { featureKeys, edgeMap, triToFace, getWorldPos, solidId } = args;

  /** facePairKey → vertex adjacency within that pair only */
  const pairAdj = new Map<string, Map<number, FeatureAdj[]>>();
  const pairSegments = new Map<string, string[]>();

  const facePairKey = (t0: number, t1: number): string => {
    const f0 = triToFace[t0] ?? -1;
    const f1 = triToFace[t1] ?? -1;
    return f0 < f1 ? `${f0}|${f1}` : `${f1}|${f0}`;
  };

  for (const key of featureKeys) {
    const rec = edgeMap.get(key)!;
    if (rec.tris.length !== 2) continue;
    const pk = facePairKey(rec.tris[0]!, rec.tris[1]!);
    if (pk.includes("-1")) continue;

    let segs = pairSegments.get(pk);
    if (!segs) {
      segs = [];
      pairSegments.set(pk, segs);
    }
    segs.push(key);

    let adj = pairAdj.get(pk);
    if (!adj) {
      adj = new Map();
      pairAdj.set(pk, adj);
    }
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

  const edges: TopologyEdge[] = [];
  const segmentPairs: {
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    edgeIndex: number;
  }[] = [];
  /** Mesh vertex → count of topo edges that end there (for selectable verts). */
  const endpointHits = new Map<number, number>();

  const pushEdgeFromPath = (path: number[]): void => {
    if (path.length < 2) return;
    const points = path.map((vi) => worldPos(vi).clone());
    const localId = `e${edges.length}`;
    const edgeIndex = edges.length;
    const v0 = path[0]!;
    const v1 = path[path.length - 1]!;
    edges.push({
      localId,
      id: makeEntityId("edge", solidId, localId),
      path: path.slice(),
      points,
      v0,
      v1,
      a: points[0]!.clone(),
      b: points[points.length - 1]!.clone(),
    });
    endpointHits.set(v0, (endpointHits.get(v0) ?? 0) + 1);
    // Closed loop: don't double-count the same vertex.
    if (v1 !== v0) {
      endpointHits.set(v1, (endpointHits.get(v1) ?? 0) + 1);
    }
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

  // One topo edge per face-pair: shortest hop path between endpoints, then
  // straighten nearly-linear edges (collapse MC zigzag) while keeping curves.
  for (const [, adj] of pairAdj) {
    let path = longestFacePairPath(adj);
    if (path.length < 2) continue;
    path = straightenIfLinear(path, worldPos, 2.5);
    pushEdgeFromPath(path);
  }

  // Selectable vertices = endpoints shared by 2+ topo edges (true corners),
  // or any endpoint if only one edge (dangling). Prefer multi-edge corners.
  const vertices: TopologyVertex[] = [];
  const sortedEndpoints = [...endpointHits.entries()].sort(
    (a, b) => a[0] - b[0],
  );
  for (const [vertexIndex, hits] of sortedEndpoints) {
    // Always expose endpoints of topo edges; corners (hits>=2) and free ends.
    if (hits < 1) continue;
    const localId = `v${vertices.length}`;
    vertices.push({
      localId,
      id: makeEntityId("vertex", solidId, localId),
      vertexIndex,
      position: worldPos(vertexIndex).clone(),
    });
  }

  // Spatial weld of near-duplicate vertices (MC corner scatter).
  const welded = weldNearbyVertices(vertices, solidId, 1.25);

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

  const vertexPositions = new Float32Array(welded.length * 3);
  welded.forEach((v, i) => {
    const o = i * 3;
    vertexPositions[o] = v.position.x;
    vertexPositions[o + 1] = v.position.y;
    vertexPositions[o + 2] = v.position.z;
  });

  return {
    edges,
    vertices: welded,
    edgePositions,
    segmentToEdge,
    vertexPositions,
  };
}

/**
 * Best simple path on a face-pair adjacency graph.
 * Open curves: BFS between valence-1 endpoints (pick path with most hops =
 * full rail of an MC ladder, not a short rung).
 * Closed loops: walk a cycle from an arbitrary vertex.
 */
function longestFacePairPath(
  adj: Map<number, FeatureAdj[]>,
): number[] {
  const nodes = [...adj.keys()];
  if (nodes.length === 0) return [];

  const endpoints = nodes.filter((v) => (adj.get(v)?.length ?? 0) === 1);

  const bfsPath = (start: number, goal: number): number[] => {
    const prev = new Map<number, number | null>();
    prev.set(start, null);
    const q = [start];
    while (q.length > 0) {
      const u = q.shift()!;
      if (u === goal) break;
      for (const n of adj.get(u) ?? []) {
        if (prev.has(n.other)) continue;
        prev.set(n.other, u);
        q.push(n.other);
      }
    }
    if (!prev.has(goal)) return [];
    const path: number[] = [];
    let cur: number | null = goal;
    while (cur != null) {
      path.push(cur);
      cur = prev.get(cur) ?? null;
    }
    path.reverse();
    return path;
  };

  if (endpoints.length >= 2) {
    let best: number[] = [];
    for (let i = 0; i < endpoints.length; i++) {
      for (let j = i + 1; j < endpoints.length; j++) {
        const path = bfsPath(endpoints[i]!, endpoints[j]!);
        if (path.length > best.length) best = path;
      }
    }
    return best;
  }

  // Closed loop: walk without repeating edges.
  const start = nodes[0]!;
  const path = [start];
  const used = new Set<string>();
  let curr = start;
  let guard = 0;
  while (guard++ < nodes.length + 2) {
    const nbrs = adj.get(curr) ?? [];
    let next: FeatureAdj | null = null;
    for (const n of nbrs) {
      if (used.has(n.key)) continue;
      if (n.other === start && path.length > 2) {
        next = n;
        break;
      }
      if (!next) next = n;
    }
    if (!next) break;
    used.add(next.key);
    curr = next.other;
    path.push(curr);
    if (curr === start && path.length > 2) break;
  }
  return path;
}

/**
 * If the path stays within maxDevMm of the chord, reorder/decimate by
 * projection onto the chord (kills MC stair zigzag on planar edges).
 * Curved arcs (sphere∩cube) keep the BFS path order.
 */
function straightenIfLinear(
  path: number[],
  worldPos: (vi: number) => Vector3,
  maxDevMm: number,
): number[] {
  if (path.length < 4) return path;
  const a = worldPos(path[0]!);
  const b = worldPos(path[path.length - 1]!);
  const ab = new Vector3().subVectors(b, a);
  const len = ab.length();
  if (len < 1e-6) return path;
  const dir = ab.clone().multiplyScalar(1 / len);
  const tmp = new Vector3();

  let maxDev = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const p = worldPos(path[i]!);
    tmp.copy(p).sub(a);
    const t = Math.min(Math.max(tmp.dot(dir), 0), len);
    const proj = a.clone().addScaledVector(dir, t);
    maxDev = Math.max(maxDev, p.distanceTo(proj));
  }
  if (maxDev > maxDevMm) return path; // curved — keep as-is

  type Sample = { vi: number; t: number };
  const samples: Sample[] = [{ vi: path[0]!, t: 0 }];
  for (let i = 1; i < path.length - 1; i++) {
    const p = worldPos(path[i]!);
    samples.push({ vi: path[i]!, t: p.clone().sub(a).dot(dir) });
  }
  samples.push({ vi: path[path.length - 1]!, t: len });
  samples.sort((u, v) => u.t - v.t);

  const out: number[] = [];
  let lastT = -Infinity;
  for (const s of samples) {
    if (out.length === 0 || s.t - lastT >= 0.75) {
      out.push(s.vi);
      lastT = s.t;
    }
  }
  // Ensure true endpoint retained.
  if (out[out.length - 1] !== path[path.length - 1]) {
    out.push(path[path.length - 1]!);
  }
  return out.length >= 2 ? out : path;
}

/** Merge selection vertices that lie within `tolMm` (keeps first occurrence). */
function weldNearbyVertices(
  vertices: TopologyVertex[],
  solidId: string,
  tolMm: number,
): TopologyVertex[] {
  const out: TopologyVertex[] = [];
  const tol2 = tolMm * tolMm;
  for (const v of vertices) {
    let dup = false;
    for (const u of out) {
      if (u.position.distanceToSquared(v.position) <= tol2) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      const localId = `v${out.length}`;
      out.push({
        localId,
        id: makeEntityId("vertex", solidId, localId),
        vertexIndex: v.vertexIndex,
        position: v.position.clone(),
      });
    }
  }
  return out;
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
