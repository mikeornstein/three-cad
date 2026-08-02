import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  LineBasicMaterial,
  LineSegments,
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
        if (edge) this.addEdgeHighlight(edge.id, edge.a, edge.b);
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
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ): void {
    const positions = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]);
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(positions, 3));
    const lines = new LineSegments(
      geom,
      new LineBasicMaterial({
        color: HIGHLIGHT_EDGE,
        transparent: true,
        opacity: 1,
        depthTest: true,
        depthWrite: false,
      }),
    );
    lines.name = `hl-edge:${id}`;
    lines.renderOrder = 5;
    this.group.add(lines);
  }

  private addVertexHighlight(
    id: string,
    position: { x: number; y: number; z: number },
  ): void {
    // ~2.5 mm sphere — readable at demo scale without hiding the solid.
    const mesh = new Mesh(
      new SphereGeometry(2.5, 16, 12),
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
