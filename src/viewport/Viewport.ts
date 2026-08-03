import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  LineSegments,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { isRayMarchMesh, updateRayMarchUniforms } from "../render";

/** World units are millimeters. Right-handed, Z-up. */
export const MM = 1;

export class Viewport {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly root = new Group();
  private readonly content = new Group();
  private solidMeshes: Mesh[] = [];
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

  /** Solid meshes currently in the content group. */
  getSolidMeshes(): readonly Mesh[] {
    return this.solidMeshes;
  }

  /** Replace scene content (demo solid, later evaluated geometry). */
  setContent(object: Object3D): void {
    this.clearGroup(this.content);
    this.solidMeshes = [];

    this.content.add(object);
    object.traverse((child) => {
      if (child instanceof Mesh) {
        this.solidMeshes.push(child);
      }
    });

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
    this.camera.updateMatrixWorld();
    // Sphere-trace shaders need camera + matrices each frame.
    for (const mesh of this.solidMeshes) {
      if (!isRayMarchMesh(mesh)) continue;
      updateRayMarchUniforms(
        mesh,
        this.camera.position,
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      );
    }
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
