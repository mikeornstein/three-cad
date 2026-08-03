import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D,
} from "three";
import {
  faceHighlightGeometry,
  solidHighlightGeometry,
  type SolidTopology,
  type TopologyFace,
  type TopologyIndex,
} from "./topology";
import type { SelectionRef } from "./types";

const HIGHLIGHT_FACE = 0xffb020;
const HIGHLIGHT_EDGE = 0xffcc44;
const HIGHLIGHT_VERTEX = 0xffee88;
const HIGHLIGHT_SOLID = 0x4fc3f7;

/** Selected-edge tube radius (mm). WebGL ignores LineBasicMaterial linewidth. */
const EDGE_HIGHLIGHT_RADIUS_MM = 0.5;
/** Shared pick-highlight opacity — slightly see-through so underlying solid still reads. */
const SELECTION_HIGHLIGHT_OPACITY = 0.65;
/** Selected-vertex sphere radius (mm). */
const VERTEX_HIGHLIGHT_RADIUS_MM = 1.4;
/** Disc radius for field region paint (mm); ~cell coverage from densify. */
const REGION_DISC_RADIUS_MM = 0.55;
/** Lift discs along normal so they sit above the ray-marched surface. */
const REGION_DISC_LIFT_MM = 0.12;
/** Flood-fill reveal duration (ms). */
const REGION_REVEAL_MS = 320;

const _edgeStart = new Vector3();
const _edgeEnd = new Vector3();
const _edgeDir = new Vector3();
const _yAxis = new Vector3(0, 1, 0);
const _zAxis = new Vector3(0, 0, 1);
const _pos = new Vector3();
const _n = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3(1, 1, 1);
const _mat = new Matrix4();

/**
 * Rebuilds visual overlays for the current selection.
 * Parent the returned group under the viewport scene (or a dedicated root).
 */
export class SelectionHighlight {
  readonly group = new Group();
  private topology: TopologyIndex | null = null;
  private revealRaf = 0;

  constructor() {
    this.group.name = "selection-highlights";
  }

  setTopology(topology: TopologyIndex | null): void {
    this.topology = topology;
    this.clear();
  }

  update(refs: readonly SelectionRef[]): void {
    this.clear();
    if (!this.topology || refs.length === 0) return;

    for (const ref of refs) {
      const entry = this.topology.byEntityId.get(ref.id);
      if (!entry) continue;
      const { solid, kind, localIndex } = entry;

      if (kind === "solid") {
        this.addSolidHighlight(solid.solidId, solid);
      } else if (kind === "face") {
        const face = solid.faces[localIndex];
        if (face) this.addFaceHighlight(face.id, solid, face);
      } else if (kind === "edge") {
        const edge = solid.edges[localIndex];
        if (edge) this.addEdgeHighlight(edge.id, edge.points);
      } else if (kind === "vertex") {
        const vertex = solid.vertices[localIndex];
        if (vertex) this.addVertexHighlight(vertex.id, vertex.position);
      }
    }
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }

  private clear(): void {
    if (this.revealRaf) {
      cancelAnimationFrame(this.revealRaf);
      this.revealRaf = 0;
    }
    while (this.group.children.length > 0) {
      const child = this.group.children[0]!;
      this.group.remove(child);
      disposeObject(child);
    }
  }

  private addSolidHighlight(id: string, solid: SolidTopology): void {
    // Ray-marched solids have no triangle soup — mark with a sphere at centroid.
    if (solid.triToFace.length === 0 && solid.field) {
      const c = new Vector3(
        (solid.field.bounds.min[0] + solid.field.bounds.max[0]) * 0.5,
        (solid.field.bounds.min[1] + solid.field.bounds.max[1]) * 0.5,
        (solid.field.bounds.min[2] + solid.field.bounds.max[2]) * 0.5,
      );
      this.addVertexHighlight(`solid-mark:${id}`, c);
      // Soft AABB wire outline
      this.addBoundsWire(solid);
      return;
    }
    const geom = solidHighlightGeometry(solid);
    const mesh = new Mesh(
      geom,
      new MeshBasicMaterial({
        color: HIGHLIGHT_SOLID,
        transparent: true,
        opacity: 0.22,
        side: DoubleSide,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    mesh.name = `hl-solid:${id}`;
    mesh.renderOrder = 3;
    this.group.add(mesh);

    // Feature edge outline for solid selection readability.
    if (solid.edges.length > 0) {
      const positions = solid.edgePositions.slice();
      const lineGeom = new BufferGeometry();
      lineGeom.setAttribute("position", new BufferAttribute(positions, 3));
      const lines = new LineSegments(
        lineGeom,
        new LineBasicMaterial({
          color: HIGHLIGHT_SOLID,
          transparent: true,
          opacity: 0.95,
          depthTest: true,
          depthWrite: false,
        }),
      );
      lines.name = `hl-solid-edges:${id}`;
      lines.renderOrder = 4;
      this.group.add(lines);
    }
  }

  private addFaceHighlight(
    id: string,
    solid: SolidTopology,
    face: TopologyFace,
  ): void {
    // Field surface-region: paint flood-fill samples as discs (visible grow).
    if (
      face.regionSamples &&
      face.regionSamples.length >= 3 &&
      face.regionNormals &&
      face.regionNormals.length === face.regionSamples.length
    ) {
      this.addRegionFacePaint(id, face);
      return;
    }
    // Field face without samples yet — seed marker only.
    if (face.triangleIndices.length === 0) {
      this.addVertexHighlight(`face-mark:${id}`, face.centroid.clone());
      return;
    }
    const geom = faceHighlightGeometry(solid, face);
    const mesh = new Mesh(
      geom,
      new MeshBasicMaterial({
        color: HIGHLIGHT_FACE,
        transparent: true,
        opacity: 0.4,
        side: DoubleSide,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    mesh.name = `hl-face:${id}`;
    mesh.renderOrder = 3;
    this.group.add(mesh);
  }

  /**
   * Paint a field surface region as instanced discs and reveal from the
   * flood-fill seed (so the grow is visible, not only the final id).
   */
  private addRegionFacePaint(id: string, face: TopologyFace): void {
    const positions = face.regionSamples!;
    const normals = face.regionNormals!;
    const count = positions.length / 3;
    if (count < 1) return;

    const geom = new CircleGeometry(REGION_DISC_RADIUS_MM, 10);
    const mat = new MeshBasicMaterial({
      color: HIGHLIGHT_FACE,
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      depthTest: true,
      depthWrite: false,
    });
    const instanced = new InstancedMesh(geom, mat, count);
    instanced.name = `hl-region:${id}`;
    instanced.renderOrder = 3;
    instanced.instanceMatrix.setUsage(DynamicDrawUsage);

    const seed = face.regionSeed ?? face.centroid;
    const dist = new Float32Array(count);
    let maxDist = 1e-6;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      const d = Math.hypot(x - seed.x, y - seed.y, z - seed.z);
      dist[i] = d;
      maxDist = Math.max(maxDist, d);
    }

    // Start collapsed at seed; reveal expands like flood-fill.
    const zero = new Vector3(0, 0, 0);
    for (let i = 0; i < count; i++) {
      _mat.compose(zero, _quat.identity(), _scale.set(0, 0, 0));
      instanced.setMatrixAt(i, _mat);
    }
    instanced.instanceMatrix.needsUpdate = true;
    this.group.add(instanced);

    // Seed marker so the click point is obvious during the reveal.
    this.addVertexHighlight(`face-seed:${id}`, seed);

    const t0 = performance.now();
    const tick = (): void => {
      const t = (performance.now() - t0) / REGION_REVEAL_MS;
      const radius = Math.min(1, Math.max(0, t)) * maxDist * 1.05;
      const done = t >= 1;
      for (let i = 0; i < count; i++) {
        const show = done || dist[i]! <= radius;
        if (!show) {
          _mat.compose(zero, _quat.identity(), _scale.set(0, 0, 0));
          instanced.setMatrixAt(i, _mat);
          continue;
        }
        _pos.set(
          positions[i * 3]!,
          positions[i * 3 + 1]!,
          positions[i * 3 + 2]!,
        );
        _n.set(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!);
        if (_n.lengthSq() < 1e-12) _n.set(0, 0, 1);
        else _n.normalize();
        // Lift slightly so discs aren't z-fighting the sphere-trace surface.
        _pos.addScaledVector(_n, REGION_DISC_LIFT_MM);
        _quat.setFromUnitVectors(_zAxis, _n);
        // Soft pop as the front passes: full size once inside radius.
        const local = done
          ? 1
          : Math.min(1, Math.max(0.15, 1 - (dist[i]! - radius + 2) / 4));
        _scale.set(local, local, local);
        _mat.compose(_pos, _quat, _scale);
        instanced.setMatrixAt(i, _mat);
      }
      instanced.instanceMatrix.needsUpdate = true;
      if (!done) {
        this.revealRaf = requestAnimationFrame(tick);
      } else {
        this.revealRaf = 0;
      }
    };
    this.revealRaf = requestAnimationFrame(tick);
  }

  /** AABB wireframe for field solids without a display mesh. */
  private addBoundsWire(solid: SolidTopology): void {
    const field = solid.field;
    if (!field) return;
    const [x0, y0, z0] = field.bounds.min;
    const [x1, y1, z1] = field.bounds.max;
    const corners = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ] as const;
    const edges: readonly [number, number][] = [
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
    const positions = new Float32Array(edges.length * 6);
    let w = 0;
    for (const [a, b] of edges) {
      const ca = corners[a]!;
      const cb = corners[b]!;
      positions[w++] = ca[0];
      positions[w++] = ca[1];
      positions[w++] = ca[2];
      positions[w++] = cb[0];
      positions[w++] = cb[1];
      positions[w++] = cb[2];
    }
    const lineGeom = new BufferGeometry();
    lineGeom.setAttribute("position", new BufferAttribute(positions, 3));
    const lines = new LineSegments(
      lineGeom,
      new LineBasicMaterial({
        color: HIGHLIGHT_SOLID,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: false,
      }),
    );
    lines.name = `hl-bounds:${solid.solidId}`;
    lines.renderOrder = 4;
    this.group.add(lines);
  }

  private addEdgeHighlight(
    id: string,
    points: readonly { x: number; y: number; z: number }[],
  ): void {
    if (points.length < 2) return;

    // Open tubes along the polyline; hemispheres only at the two free ends.
    // Full spheres at joints double opacity with the tubes when transparent.
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      _edgeStart.set(a.x, a.y, a.z);
      _edgeEnd.set(b.x, b.y, b.z);
      _edgeDir.subVectors(_edgeEnd, _edgeStart);
      const length = _edgeDir.length();
      if (length < 1e-9) continue;

      const mesh = new Mesh(
        new CylinderGeometry(
          EDGE_HIGHLIGHT_RADIUS_MM,
          EDGE_HIGHLIGHT_RADIUS_MM,
          length,
          10,
          1,
          true, // open-ended; end hemispheres close the free tips
        ),
        edgeHighlightMaterial(),
      );
      mesh.position.copy(_edgeStart).add(_edgeEnd).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(_yAxis, _edgeDir.normalize());
      mesh.name = `hl-edge:${id}:${i}`;
      mesh.renderOrder = 5;
      this.group.add(mesh);
    }

    const first = points[0]!;
    const second = points[1]!;
    const last = points[points.length - 1]!;
    const prev = points[points.length - 2]!;

    // Outward normals: dome away from the edge so the flat sits on the tube end.
    this.addEdgeHemisphereCap(
      id,
      "start",
      first,
      _edgeDir.set(first.x - second.x, first.y - second.y, first.z - second.z),
    );
    this.addEdgeHemisphereCap(
      id,
      "end",
      last,
      _edgeDir.set(last.x - prev.x, last.y - prev.y, last.z - prev.z),
    );
  }

  /**
   * Hemisphere cap at a free edge end. SphereGeometry theta 0..π/2 is the +Y dome
   * with its flat on the XZ plane through the origin (matches open cylinder end).
   */
  private addEdgeHemisphereCap(
    id: string,
    which: "start" | "end",
    position: { x: number; y: number; z: number },
    outward: Vector3,
  ): void {
    if (outward.lengthSq() < 1e-20) return;
    const cap = new Mesh(
      new SphereGeometry(
        EDGE_HIGHLIGHT_RADIUS_MM,
        12,
        8,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
      edgeHighlightMaterial(),
    );
    cap.position.set(position.x, position.y, position.z);
    cap.quaternion.setFromUnitVectors(_yAxis, outward.normalize());
    cap.name = `hl-edge-cap:${id}:${which}`;
    cap.renderOrder = 5;
    this.group.add(cap);
  }

  private addVertexHighlight(
    id: string,
    position: { x: number; y: number; z: number },
  ): void {
    const mesh = new Mesh(
      new SphereGeometry(VERTEX_HIGHLIGHT_RADIUS_MM, 12, 10),
      new MeshBasicMaterial({
        color: HIGHLIGHT_VERTEX,
        transparent: true,
        opacity: SELECTION_HIGHLIGHT_OPACITY,
        depthTest: true,
        depthWrite: false,
      }),
    );
    mesh.position.set(position.x, position.y, position.z);
    mesh.name = `hl-vertex:${id}`;
    mesh.renderOrder = 6;
    this.group.add(mesh);
  }
}

function edgeHighlightMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: HIGHLIGHT_EDGE,
    transparent: true,
    opacity: SELECTION_HIGHLIGHT_OPACITY,
    depthTest: true,
    depthWrite: false,
  });
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (
      child instanceof Mesh ||
      child instanceof LineSegments ||
      child instanceof InstancedMesh
    ) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const m of materials) m.dispose();
    }
  });
}
