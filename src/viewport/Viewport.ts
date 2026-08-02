import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  EdgesGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  type DisplayMode,
  displayModeLabel,
  nextDisplayMode,
} from "./displayMode";

/** World units are millimeters. Right-handed, Z-up. */
export const MM = 1;

/** User-data key for mesh-mode edge overlays parented under solid meshes. */
const EDGE_OVERLAY_FLAG = "threeCadEdgeOverlay";

export class Viewport {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly root = new Group();
  private readonly content = new Group();
  private solidMeshes: Mesh[] = [];
  private edgeOverlays: LineSegments[] = [];
  private displayMode: DisplayMode = "solid";
  private animationId = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new Color(0x1a1c1e);
    this.scene.add(this.root);
    this.root.add(this.content);

    this.camera = new PerspectiveCamera(50, 1, 0.1 * MM, 100_000 * MM);
    this.camera.up.set(0, 0, 1);

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;

    this.addLights();
    this.addScaleCues();
    this.onResize();
    window.addEventListener("resize", this.onResize);
    this.loop();
  }

  getDisplayMode(): DisplayMode {
    return this.displayMode;
  }

  /** Cycle solid → mesh (edges) → wireframe. Returns the new mode. */
  cycleDisplayMode(): DisplayMode {
    return this.setDisplayMode(nextDisplayMode(this.displayMode));
  }

  setDisplayMode(mode: DisplayMode): DisplayMode {
    this.displayMode = mode;
    this.applyDisplayMode();
    return this.displayMode;
  }

  /** Replace scene content (demo solid, later evaluated geometry). */
  setContent(object: Object3D): void {
    this.clearGroup(this.content);
    this.solidMeshes = [];
    this.edgeOverlays = [];

    this.content.add(object);
    object.traverse((child) => {
      if (child instanceof Mesh && !child.userData[EDGE_OVERLAY_FLAG]) {
        this.solidMeshes.push(child);
      }
    });

    this.rebuildEdgeOverlays();
    this.applyDisplayMode();
    this.frameObject(object);
  }

  frameObject(object: Object3D): void {
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;

    this.controls.target.copy(center);

    // Isometric-ish view for Z-up mechanical inspection.
    const distance =
      (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.35;
    const dir = new Vector3(1, -1.15, 0.85).normalize();
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.near = Math.max(distance / 500, 0.01);
    this.camera.far = distance * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.onResize);
    this.clearGroup(this.content);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private applyDisplayMode(): void {
    const showSolid =
      this.displayMode === "solid" || this.displayMode === "mesh";
    const showWire = this.displayMode === "wireframe";
    const showEdges = this.displayMode === "mesh";

    this.content.visible = showSolid || showWire;

    for (const mesh of this.solidMeshes) {
      // Keep solid mesh itself visible in solid/mesh/wire modes.
      mesh.visible = true;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const mat of materials) {
        if ("wireframe" in mat) {
          (mat as Material & { wireframe: boolean }).wireframe = showWire;
        }
        // Push solid faces back slightly so coplanar edge lines win the depth test.
        if (isOffsetable(mat)) {
          mat.polygonOffset = showEdges;
          mat.polygonOffsetFactor = showEdges ? 1 : 0;
          mat.polygonOffsetUnits = showEdges ? 1 : 0;
          mat.needsUpdate = true;
        }
      }
    }

    for (const lines of this.edgeOverlays) {
      lines.visible = showEdges;
    }
  }

  private rebuildEdgeOverlays(): void {
    for (const lines of this.edgeOverlays) {
      lines.removeFromParent();
      disposeObject(lines);
    }
    this.edgeOverlays = [];

    // Feature edges (dihedral > threshold). Coplanar triangulation diagonals stay hidden.
    // ~20° keeps cube/sphere crease edges without every geodesic facet on a fine sphere.
    const thresholdAngle = 20;

    for (const mesh of this.solidMeshes) {
      const edges = new EdgesGeometry(mesh.geometry, thresholdAngle);
      const lines = new LineSegments(
        edges,
        new LineBasicMaterial({
          // High contrast on the blue solid; near-black was invisible after z-fight.
          color: 0xf2f5f8,
          transparent: true,
          opacity: 0.95,
          depthTest: true,
          depthWrite: false,
        }),
      );
      lines.name = `${mesh.name || "mesh"}-edges`;
      lines.userData[EDGE_OVERLAY_FLAG] = true;
      // Draw after the solid so polygon-offset faces don't obscure the lines.
      lines.renderOrder = 1;
      // Parent under the mesh so any future transform stays aligned.
      mesh.add(lines);
      this.edgeOverlays.push(lines);
    }
  }

  private clearGroup(group: Group): void {
    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
      disposeObject(child);
    }
  }

  private addLights(): void {
    const ambient = new AmbientLight(0xffffff, 0.55);
    const key = new DirectionalLight(0xffffff, 0.95);
    key.position.set(200, -120, 280);
    const fill = new DirectionalLight(0xb0c4de, 0.4);
    fill.position.set(-180, 100, 80);
    this.root.add(ambient, key, fill);
  }

  private addScaleCues(): void {
    // GridHelper is XZ by default (Y-up). Rotate into XY so Z is up.
    const gridSize = 400 * MM;
    const divisions = 40; // 10 mm cells
    const grid = new GridHelper(gridSize, divisions, 0x5a6570, 0x2e343a);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0;
    this.root.add(grid);

    const axes = new AxesHelper(80 * MM);
    this.root.add(axes);
  }

  private readonly onResize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private readonly loop = (): void => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
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

function isOffsetable(
  mat: Material,
): mat is Material & Pick<
  MeshStandardMaterial,
  "polygonOffset" | "polygonOffsetFactor" | "polygonOffsetUnits" | "needsUpdate"
> {
  return "polygonOffset" in mat;
}

export { displayModeLabel };
