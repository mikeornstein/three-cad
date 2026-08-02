import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
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
const EDGE_HIGHLIGHT_RADIUS_MM = 0.7;
/** Edge highlight opacity — slightly see-through so underlying solid still reads. */
const EDGE_HIGHLIGHT_OPACITY = 0.65;
/** Selected-vertex sphere radius (mm). */
const VERTEX_HIGHLIGHT_RADIUS_MM = 1.4;

const _edgeStart = new Vector3();
const _edgeEnd = new Vector3();
const _edgeDir = new Vector3();
const _yAxis = new Vector3(0, 1, 0);

/**
 * Rebuilds visual overlays for the current selection.
 * Parent the returned group under the viewport scene (or a dedicated root).
 */
export class SelectionHighlight {
  readonly group = new Group();
  private topology: TopologyIndex | null = null;

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
    while (this.group.children.length > 0) {
      const child = this.group.children[0]!;
      this.group.remove(child);
      disposeObject(child);
    }
  }

  private addSolidHighlight(id: string, solid: SolidTopology): void {
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
        opacity: 0.95,
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
    opacity: EDGE_HIGHLIGHT_OPACITY,
    depthTest: true,
    depthWrite: false,
  });
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh || child instanceof LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const m of materials) m.dispose();
    }
  });
}
