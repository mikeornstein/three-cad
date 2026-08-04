import {
  Vector3,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
} from "three";
import {
  isRayMarchMesh,
  pickFieldAtPointer,
} from "../render";
import { buildRayMarchTopologyIndex } from "../render/fieldTopology";
import {
  classifyCreaseFeature,
  densifyRegionForHighlight,
  featureScore,
  growSurfaceRegion,
  type SurfaceRegion,
} from "../sdf";
import { SelectionHighlight } from "./highlight";
import { buildPickHelpers, pickAtPointer } from "./pick";
import { SelectionStore } from "./SelectionStore";
import {
  buildTopologyIndex,
  refFromTopology,
  type SolidTopology,
  type TopologyIndex,
  type TopologyEdge,
  type TopologyVertex,
} from "./topology";
import {
  formatSelectionClipboard,
  makeEntityId,
  nextSelectionFilter,
  type SelectionFilter,
  type SelectionRef,
} from "./types";

export interface SelectionControllerOptions {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /**
   * Called after every selection change with the clipboard payload
   * (one id per line, or "" when empty).
   */
  onClipboardPayload?: (text: string, refs: readonly SelectionRef[]) => void;
  /** Optional informational messages (topology ready, etc.). */
  onInfo?: (message: string) => void;
}

const CLICK_MOVE_PX = 5;

/**
 * Owns topology, multi-select, pointer picking, highlights, and clipboard payload.
 * Does not implement measure/edit actions — only selection context.
 */
export class SelectionController {
  readonly store = new SelectionStore();
  readonly highlight = new SelectionHighlight();

  private topology: TopologyIndex | null = null;
  private pickHelpers: Object3D[] = [];
  private solidMeshes: Mesh[] = [];
  private filter: SelectionFilter = "all";
  private disposed = false;

  private pointerDown: {
    x: number;
    y: number;
    pointerId: number;
  } | null = null;

  private readonly opts: SelectionControllerOptions;
  private unsubStore: (() => void) | null = null;

  constructor(opts: SelectionControllerOptions) {
    this.opts = opts;
    opts.scene.add(this.highlight.group);

    this.unsubStore = this.store.subscribe((refs) => {
      this.highlight.update(refs);
      this.emitClipboard(refs);
    });

    const el = opts.canvas;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerCancel);
  }

  getFilter(): SelectionFilter {
    return this.filter;
  }

  setFilter(filter: SelectionFilter): SelectionFilter {
    this.filter = filter;
    return this.filter;
  }

  cycleFilter(): SelectionFilter {
    this.filter = nextSelectionFilter(this.filter);
    return this.filter;
  }

  /**
   * Rebuild field-native topology + pick helpers from solid meshes.
   * Expects `mesh.userData.fieldSolid` when the authority field is available.
   * Ray-march display meshes use leaf faces + CPU sphere-trace pick (no MC).
   * Call after Viewport.setContent (or whenever evaluated geometry changes).
   */
  setMeshes(meshes: readonly Mesh[]): void {
    this.disposePickHelpers();
    this.solidMeshes = [...meshes];

    const rayMarch = this.solidMeshes.filter(isRayMarchMesh);
    const tessellated = this.solidMeshes.filter((m) => !isRayMarchMesh(m));

    if (rayMarch.length > 0 && tessellated.length === 0) {
      this.topology = buildRayMarchTopologyIndex(rayMarch);
      this.pickHelpers = [];
    } else {
      this.topology = buildTopologyIndex(
        tessellated.length > 0 ? tessellated : this.solidMeshes,
      );
      this.pickHelpers = buildPickHelpers(this.topology);
      for (const h of this.pickHelpers) {
        this.opts.scene.add(h);
      }
    }

    this.highlight.setTopology(this.topology);
    this.store.clear();

    const summary = this.topology.solids
      .map((s) => {
        const leaves = new Set(
          s.faces.map((f) => f.leafId).filter((id): id is string => !!id),
        );
        const leafPart =
          leaves.size > 0 ? `, leaves [${[...leaves].join(", ")}]` : ", no field leaves";
        const fieldPart = isRayMarchMesh(s.mesh)
          ? "field-raymarch"
          : s.field
            ? "field"
            : "mesh-only";
        return `${s.solidId} (${fieldPart}): ${s.faces.length} faces, ${s.edges.length} edges, ${s.vertices.length} verts${leafPart}`;
      })
      .join("; ");
    this.opts.onInfo?.(`selection topology — ${summary || "empty"}`);
  }

  getTopology(): TopologyIndex | null {
    return this.topology;
  }

  getTopologySummary(): string {
    if (!this.topology) return "no topology";
    return this.topology.solids
      .map(
        (s) =>
          `${s.solidId}: ${s.faces.length}f ${s.edges.length}e ${s.vertices.length}v`,
      )
      .join(", ");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const el = this.opts.canvas;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerCancel);
    this.unsubStore?.();
    this.unsubStore = null;
    this.disposePickHelpers();
    this.highlight.dispose();
  }

  private disposePickHelpers(): void {
    for (const h of this.pickHelpers) {
      h.removeFromParent();
      // Geometry/materials on helpers
      const any = h as unknown as {
        geometry?: { dispose: () => void };
        material?: { dispose: () => void } | { dispose: () => void }[];
      };
      any.geometry?.dispose();
      if (Array.isArray(any.material)) {
        for (const m of any.material) m.dispose();
      } else {
        any.material?.dispose();
      }
    }
    this.pickHelpers = [];
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  };

  private readonly onPointerCancel = (): void => {
    this.pointerDown = null;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.pointerId !== event.pointerId) return;

    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    if (dx * dx + dy * dy > CLICK_MOVE_PX * CLICK_MOVE_PX) {
      // Treated as orbit/pan drag — do not change selection.
      return;
    }

    if (!this.topology) return;

    const hit = this.resolvePick(event.clientX, event.clientY);

    if (event.shiftKey) {
      if (hit) this.store.toggle(hit);
      // Shift + miss: keep selection (CAD-style).
      return;
    }

    if (hit) {
      this.store.set([hit]);
    } else {
      this.store.clear();
    }
  };

  private resolvePick(clientX: number, clientY: number): SelectionRef | null {
    if (!this.topology) return null;

    const rayMarchSolids = this.topology.solids.filter((s) =>
      isRayMarchMesh(s.mesh),
    );

    // Mesh-free pick path for GPU sphere-trace display.
    if (rayMarchSolids.length > 0) {
      const filter = this.filter;
      const targets = rayMarchSolids
        .filter((s) => s.field)
        .map((s) => ({ field: s.field!, solidId: s.solidId }));
      const fieldHit = pickFieldAtPointer(
        clientX,
        clientY,
        this.opts.camera,
        this.opts.canvas,
        targets,
      );
      if (!fieldHit) return null;

      const solid =
        rayMarchSolids.find((s) => s.solidId === fieldHit.solidId) ??
        rayMarchSolids[0]!;
      const hitPt: [number, number, number] = [
        fieldHit.point.x,
        fieldHit.point.y,
        fieldHit.point.z,
      ];

      if (filter === "solid") {
        return refFromTopology(solid, "solid", 0);
      }

      // Priority for "all": vertex → edge → face (when near creases).
      const wantVertex = filter === "all" || filter === "vertex";
      const wantEdge = filter === "all" || filter === "edge";
      const wantFace = filter === "all" || filter === "face";

      if ((wantVertex || wantEdge) && solid.field) {
        const score = featureScore(solid.field, hitPt);
        // Edge/vertex filters force crease snap; "all" only when on a crease.
        const forceCrease = filter === "edge" || filter === "vertex";
        const onCrease = score >= 0.18;
        if (forceCrease || onCrease) {
          const crease = classifyCreaseFeature(solid.field, hitPt);
          if (crease?.kind === "vertex" && wantVertex) {
            const vi = ensureFieldVertex(
              solid,
              crease.position,
              this.topology!,
            );
            return refFromTopology(solid, "vertex", vi);
          }
          if (crease?.kind === "edge" && wantEdge) {
            const ei = ensureFieldEdge(solid, crease, this.topology!);
            return refFromTopology(solid, "edge", ei);
          }
          if (filter === "vertex" || filter === "edge") {
            return null;
          }
        }
      }

      if (wantFace) {
        const region = growSurfaceRegion(fieldHit.field, hitPt);
        if (region) {
          const faceIndex = ensureRegionFace(solid, region, this.topology!);
          return refFromTopology(solid, "face", faceIndex);
        }
      }
      return refFromTopology(solid, "solid", 0);
    }

    return pickAtPointer(clientX, clientY, {
      camera: this.opts.camera,
      canvas: this.opts.canvas,
      solidMeshes: this.solidMeshes,
      pickHelpers: this.pickHelpers,
      topology: this.topology,
      filter: this.filter,
    });
  }

  private emitClipboard(refs: readonly SelectionRef[]): void {
    const text = formatSelectionClipboard(refs);
    // Always notify UI (console). Clipboard write is best-effort.
    this.opts.onClipboardPayload?.(text, refs);

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      // Empty selection → clear clipboard payload to "" so paste state matches UI.
      void navigator.clipboard.writeText(text).catch(() => {
        // Permissions / non-secure context — console still shows the payload.
      });
    }
  }
}

/**
 * Register (or refresh) a surface-region face on the solid topology for
 * highlight / measure lookup. Mutates topology maps.
 * Reuses densified paint when re-selecting the same regionKey (less lag).
 */
function ensureRegionFace(
  solid: SolidTopology,
  region: SurfaceRegion,
  topology: TopologyIndex,
): number {
  const localId = region.regionKey;
  let faceIndex = solid.faces.findIndex((f) => f.localId === localId);
  const centroid = new Vector3(
    region.centroid[0],
    region.centroid[1],
    region.centroid[2],
  );
  const normal = new Vector3(
    region.meanNormal[0],
    region.meanNormal[1],
    region.meanNormal[2],
  );
  const seed = new Vector3(region.seed[0], region.seed[1], region.seed[2]);

  const planeFrame = region.planeFrame
    ? {
        width: region.planeFrame.width,
        height: region.planeFrame.height,
        centroid: new Vector3(
          region.planeFrame.centroid[0],
          region.planeFrame.centroid[1],
          region.planeFrame.centroid[2],
        ),
        normal: new Vector3(
          region.planeFrame.normal[0],
          region.planeFrame.normal[1],
          region.planeFrame.normal[2],
        ),
        rectangular: region.planeFrame.rectangular,
      }
    : undefined;

  // Freeform: densify discs. Planar: PlaneGeometry via regionPlane (fast/full).
  let dense: { positions: Float32Array; normals: Float32Array } | null = null;
  if (!region.planar && solid.field) {
    if (faceIndex >= 0) {
      const existing = solid.faces[faceIndex]!;
      if (
        existing.regionSamples &&
        existing.regionSamples.length >= 30 &&
        existing.regionNormals
      ) {
        dense = {
          positions: existing.regionSamples,
          normals: existing.regionNormals,
        };
      }
    }
    if (!dense) {
      dense = densifyRegionForHighlight(solid.field, region);
    }
  }

  if (faceIndex < 0) {
    faceIndex = solid.faces.length;
    const id = makeEntityId("face", solid.solidId, localId);
    solid.faces.push({
      localId,
      id,
      leafId: region.leafId,
      triangleIndices: [],
      centroid: planeFrame?.centroid.clone() ?? centroid,
      normal: planeFrame?.normal.clone() ?? normal,
      fieldMeasured: false,
      regionSamples: dense?.positions,
      regionNormals: dense?.normals,
      regionSeed: seed,
      regionPlanar: region.planar,
      regionPlane: planeFrame,
    });
    topology.byEntityId.set(id, {
      solid,
      kind: "face",
      localIndex: faceIndex,
    });
  } else {
    const face = solid.faces[faceIndex]!;
    if (planeFrame) {
      face.centroid.copy(planeFrame.centroid);
      face.normal.copy(planeFrame.normal);
      face.regionPlane = planeFrame;
    } else {
      face.centroid.copy(centroid);
      face.normal.copy(normal);
    }
    face.leafId = region.leafId;
    face.fieldMeasured = false;
    face.area = undefined;
    if (dense) {
      face.regionSamples = dense.positions;
      face.regionNormals = dense.normals;
    }
    face.regionSeed = seed;
    face.regionPlanar = region.planar;
  }
  return faceIndex;
}

function ensureFieldVertex(
  solid: SolidTopology,
  position: readonly [number, number, number],
  topology: TopologyIndex,
): number {
  const key = `v-${position[0].toFixed(2)}-${position[1].toFixed(2)}-${position[2].toFixed(2)}`;
  let idx = solid.vertices.findIndex((v) => v.localId === key);
  const pos = new Vector3(position[0], position[1], position[2]);
  if (idx < 0) {
    idx = solid.vertices.length;
    const id = makeEntityId("vertex", solid.solidId, key);
    const vertex: TopologyVertex = {
      localId: key,
      id,
      vertexIndex: -1,
      position: pos,
      fieldMeasured: true,
    };
    solid.vertices.push(vertex);
    solid.vertexByIndex.push(vertex);
    topology.byEntityId.set(id, {
      solid,
      kind: "vertex",
      localIndex: idx,
    });
  } else {
    solid.vertices[idx]!.position.copy(pos);
  }
  return idx;
}

function ensureFieldEdge(
  solid: SolidTopology,
  crease: {
    measure: {
      points: readonly (readonly [number, number, number])[];
      a: readonly [number, number, number];
      b: readonly [number, number, number];
      length: number;
      linear: boolean;
    };
    a: readonly [number, number, number];
    b: readonly [number, number, number];
  },
  topology: TopologyIndex,
): number {
  const a = crease.a;
  const b = crease.b;
  const key = `e-${a[0].toFixed(1)}-${a[1].toFixed(1)}-${a[2].toFixed(1)}_${b[0].toFixed(1)}-${b[1].toFixed(1)}-${b[2].toFixed(1)}`;
  let idx = solid.edges.findIndex((e) => e.localId === key);
  const points = crease.measure.points.map(
    (p) => new Vector3(p[0], p[1], p[2]),
  );
  if (idx < 0) {
    idx = solid.edges.length;
    const id = makeEntityId("edge", solid.solidId, key);
    const edge: TopologyEdge = {
      localId: key,
      id,
      path: [],
      points,
      v0: -1,
      v1: -1,
      a: new Vector3(a[0], a[1], a[2]),
      b: new Vector3(b[0], b[1], b[2]),
      length: crease.measure.length,
      fieldMeasured: true,
    };
    solid.edges.push(edge);
    solid.edgeByIndex.push(edge);
    topology.byEntityId.set(id, {
      solid,
      kind: "edge",
      localIndex: idx,
    });
  } else {
    const edge = solid.edges[idx]!;
    edge.points = points;
    edge.a.set(a[0], a[1], a[2]);
    edge.b.set(b[0], b[1], b[2]);
    edge.length = crease.measure.length;
    edge.fieldMeasured = true;
  }
  return idx;
}
