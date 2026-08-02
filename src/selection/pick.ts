import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Vector2,
  type Intersection,
  type Object3D,
} from "three";
import {
  refFromTopology,
  type SolidTopology,
  type TopologyIndex,
} from "./topology";
import type { SelectionFilter, SelectionRef } from "./types";

const PICK_USER = "threeCadPick";

export type PickLayerKind = "edge" | "vertex";

export interface PickUserData {
  [PICK_USER]: true;
  solidId: string;
  layer: PickLayerKind;
}

function isPickUserData(data: unknown): data is PickUserData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as PickUserData)[PICK_USER] === true
  );
}

/**
 * Invisible pick helpers for feature edges and vertices.
 * Face/solid picks use the real solid meshes.
 */
export function buildPickHelpers(index: TopologyIndex): Object3D[] {
  const helpers: Object3D[] = [];

  for (const solid of index.solids) {
    if (solid.edges.length > 0) {
      const geom = new BufferGeometry();
      geom.setAttribute(
        "position",
        new BufferAttribute(solid.edgePositions.slice(), 3),
      );
      const lines = new LineSegments(
        geom,
        new LineBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      lines.name = `pick-edges:${solid.solidId}`;
      lines.userData = {
        [PICK_USER]: true,
        solidId: solid.solidId,
        layer: "edge",
      } satisfies PickUserData;
      helpers.push(lines);
    }

    if (solid.vertices.length > 0) {
      const geom = new BufferGeometry();
      geom.setAttribute(
        "position",
        new BufferAttribute(solid.vertexPositions.slice(), 3),
      );
      const points = new Points(
        geom,
        new PointsMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          size: 1,
        }),
      );
      points.name = `pick-verts:${solid.solidId}`;
      points.userData = {
        [PICK_USER]: true,
        solidId: solid.solidId,
        layer: "vertex",
      } satisfies PickUserData;
      helpers.push(points);
    }
  }

  return helpers;
}

export interface PickContext {
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** Solid meshes (face / body hits). */
  solidMeshes: readonly Mesh[];
  /** Invisible edge/vertex helpers. */
  pickHelpers: readonly Object3D[];
  topology: TopologyIndex;
  filter: SelectionFilter;
  /** World-space threshold for line/point hits (mm), scaled by camera distance. */
  baseThresholdMm?: number;
}

const _ndc = new Vector2();
const _raycaster = new Raycaster();

/**
 * Resolve the best selection under the pointer.
 * Priority when filter is `all`: vertex → edge → face (never solid).
 * Specific filters return only that kind (solid = whole mesh on any face hit).
 */
export function pickAtPointer(
  clientX: number,
  clientY: number,
  ctx: PickContext,
): SelectionRef | null {
  const rect = ctx.canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_ndc, ctx.camera);

  const threshold = estimateThresholdMm(ctx);
  _raycaster.params.Line = { threshold };
  _raycaster.params.Points = { threshold };

  const filter = ctx.filter;
  const allowVertex = filter === "all" || filter === "vertex";
  const allowEdge = filter === "all" || filter === "edge";
  const allowFace = filter === "all" || filter === "face";
  const allowSolid = filter === "solid";

  // --- vertices (highest priority in "all") ---
  if (allowVertex) {
    const vertexHelpers = ctx.pickHelpers.filter(
      (h) => isPickUserData(h.userData) && h.userData.layer === "vertex",
    );
    const hits = _raycaster.intersectObjects(vertexHelpers, false);
    const best = firstValidVertexHit(hits, ctx.topology);
    if (best) return best;
  }

  // --- edges ---
  if (allowEdge) {
    const edgeHelpers = ctx.pickHelpers.filter(
      (h) => isPickUserData(h.userData) && h.userData.layer === "edge",
    );
    const hits = _raycaster.intersectObjects(edgeHelpers, false);
    const best = firstValidEdgeHit(hits, ctx.topology);
    if (best) return best;
  }

  // --- faces / solids via mesh raycast ---
  if (allowFace || allowSolid) {
    const targets: Object3D[] = [...ctx.solidMeshes];
    const hits = _raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      if (!(hit.object instanceof Mesh)) continue;
      const solid = findSolidForMesh(ctx.topology, hit.object);
      if (!solid) continue;

      if (allowSolid) {
        return refFromTopology(solid, "solid", 0);
      }

      // Face from triangle index.
      const faceIndex = hit.faceIndex;
      if (faceIndex == null || faceIndex < 0) continue;
      const faceLocal = solid.triToFace[faceIndex];
      if (faceLocal === undefined || faceLocal < 0) continue;
      return refFromTopology(solid, "face", faceLocal);
    }
  }

  return null;
}

function estimateThresholdMm(ctx: PickContext): number {
  // ~8 px in world units at a typical distance to origin / content.
  const base = ctx.baseThresholdMm ?? 1.2;
  const dist = ctx.camera.position.length();
  // Scale gently with distance so zoomed-out picks stay usable.
  return Math.max(base, dist * 0.004);
}

function findSolidForMesh(
  topology: TopologyIndex,
  mesh: Mesh,
): SolidTopology | null {
  return topology.solids.find((s) => s.mesh === mesh) ?? null;
}

function firstValidVertexHit(
  hits: Intersection[],
  topology: TopologyIndex,
): SelectionRef | null {
  for (const hit of hits) {
    const data = hit.object.userData;
    if (!isPickUserData(data) || data.layer !== "vertex") continue;
    const solid = topology.solids.find((s) => s.solidId === data.solidId);
    if (!solid) continue;
    const idx = hit.index;
    if (idx === undefined || idx < 0 || idx >= solid.vertices.length) continue;
    return refFromTopology(solid, "vertex", idx);
  }
  return null;
}

function firstValidEdgeHit(
  hits: Intersection[],
  topology: TopologyIndex,
): SelectionRef | null {
  for (const hit of hits) {
    const data = hit.object.userData;
    if (!isPickUserData(data) || data.layer !== "edge") continue;
    const solid = topology.solids.find((s) => s.solidId === data.solidId);
    if (!solid) continue;
    // LineSegments: index is the starting vertex index in the position buffer
    // (2 verts per segment) → segment index = index / 2 when non-indexed.
    // segmentToEdge maps mesh segments → topological (chained) edges.
    const idx = hit.index;
    if (idx === undefined || idx < 0) continue;
    const segmentIndex = Math.floor(idx / 2);
    if (segmentIndex < 0 || segmentIndex >= solid.segmentToEdge.length) continue;
    const edgeIndex = solid.segmentToEdge[segmentIndex]!;
    if (edgeIndex < 0 || edgeIndex >= solid.edges.length) continue;
    return refFromTopology(solid, "edge", edgeIndex);
  }
  return null;
}
