/**
 * Build a Three.js Mesh that sphere-traces a FieldNode inside its AABB.
 * Display only — no triangle solid; field remains authority.
 */

import {
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";
import type { FieldNode } from "../document/fieldDef";
import type { FieldSolid } from "../sdf";
import { fieldNodeToGlsl } from "./fieldToGlsl";
import {
  buildSphereTraceFragment,
  SPHERE_TRACE_VERTEX,
} from "./sphereTraceShaders";

/** userData flag: this mesh is a field ray-march proxy, not a tessellation. */
export const RAY_MARCH_USER = "threeCadRayMarch";

export interface FieldRayMarchOptions {
  readonly name?: string;
  readonly color?: number;
  readonly definitionHash?: string;
  /** Pad AABB (mm) so sphere-trace does not clip the surface. Default 1. */
  readonly padMm?: number;
  /** Max sphere-trace steps. Default 128. */
  readonly maxSteps?: number;
  /** Surface hit epsilon (mm). Default 0.05. */
  readonly surfaceEpsMm?: number;
}

export interface FieldRayMarchMesh extends Mesh {
  material: ShaderMaterial;
}

/**
 * Create an AABB box mesh whose fragment shader sphere-traces `fieldNode`.
 * Attaches `fieldSolid` for CPU pick / measure when provided.
 */
export function createFieldRayMarchMesh(
  fieldNode: FieldNode,
  fieldSolid: FieldSolid | undefined,
  options: FieldRayMarchOptions = {},
): FieldRayMarchMesh {
  const compiled = fieldNodeToGlsl(fieldNode);
  const pad = options.padMm ?? 1;
  const min = compiled.bounds.min;
  const max = compiled.bounds.max;

  const sx = Math.max(max[0] - min[0], 1e-3) + pad * 2;
  const sy = Math.max(max[1] - min[1], 1e-3) + pad * 2;
  const sz = Math.max(max[2] - min[2], 1e-3) + pad * 2;
  const cx = (min[0] + max[0]) * 0.5;
  const cy = (min[1] + max[1]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;

  const geometry = new BoxGeometry(sx, sy, sz);
  geometry.translate(cx, cy, cz);

  const color = new Color(options.color ?? 0x6e9fd4);
  const material = new ShaderMaterial({
    vertexShader: SPHERE_TRACE_VERTEX,
    fragmentShader: buildSphereTraceFragment(compiled.mapSource),
    uniforms: {
      uCameraPos: { value: new Vector3() },
      uProjectionMatrix: { value: null },
      uViewMatrix: { value: null },
      uBoundsMin: {
        value: new Vector3(min[0] - pad, min[1] - pad, min[2] - pad),
      },
      uBoundsMax: {
        value: new Vector3(max[0] + pad, max[1] + pad, max[2] + pad),
      },
      uColor: { value: color },
      uAmbient: { value: new Color(0xffffff).multiplyScalar(0.55) },
      // Match Viewport lights (key + fill directions in world space)
      uKeyDir: { value: new Vector3(200, -120, 280).normalize() },
      uKeyColor: { value: new Color(0xffffff).multiplyScalar(0.95) },
      uFillDir: { value: new Vector3(-180, 100, 80).normalize() },
      uFillColor: { value: new Color(0xb0c4de).multiplyScalar(0.4) },
      uMaxSteps: { value: options.maxSteps ?? 128 },
      uSurfaceEps: { value: options.surfaceEpsMm ?? 0.05 },
      uNormalEps: { value: 0.08 },
    },
    side: DoubleSide,
    // Transparent false; discarded fragments leave grid visible.
    depthTest: true,
    depthWrite: true,
  });

  // gl_FragDepth: request WebGL1 EXT_frag_depth when available (ignored on WebGL2).
  Object.assign(material.extensions, { fragDepth: true });

  const mesh = new Mesh(geometry, material) as FieldRayMarchMesh;
  if (options.name) mesh.name = options.name;
  mesh.userData[RAY_MARCH_USER] = true;
  mesh.userData.fieldNode = fieldNode;
  if (fieldSolid) mesh.userData.fieldSolid = fieldSolid;
  if (options.definitionHash !== undefined) {
    mesh.userData.definitionHash = options.definitionHash;
  }
  mesh.frustumCulled = true;

  return mesh;
}

/** True when a mesh is a field sphere-trace display proxy. */
export function isRayMarchMesh(mesh: Mesh): boolean {
  return mesh.userData?.[RAY_MARCH_USER] === true;
}

/** Sync camera uniforms before render (call from Viewport loop). */
export function updateRayMarchUniforms(
  mesh: Mesh,
  cameraPos: Vector3,
  projectionMatrix: unknown,
  viewMatrix: unknown,
): void {
  if (!isRayMarchMesh(mesh)) return;
  const mat = mesh.material;
  if (!(mat instanceof ShaderMaterial)) return;
  mat.uniforms.uCameraPos.value.copy(cameraPos);
  mat.uniforms.uProjectionMatrix.value = projectionMatrix;
  mat.uniforms.uViewMatrix.value = viewMatrix;
}

