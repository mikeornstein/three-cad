/**
 * Build a Three.js Mesh that sphere-traces a FieldNode inside its AABB
 * via WebGPU / WGSL (MeshBasicNodeMaterial + TSL).
 * Display only — no triangle solid; field remains authority.
 */

import {
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  Vector3,
} from "three";
import type { Node } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Discard,
  Fn,
  If,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraViewMatrix,
  float,
  normalize,
  positionWorld,
  uniform,
  vec4,
  viewZToPerspectiveDepth,
  wgslFn,
} from "three/tsl";
import type { FieldNode } from "../document/fieldDef";
import type { FieldSolid } from "../sdf";
import { fieldNodeToWgsl } from "./fieldToWgsl";

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
  material: MeshBasicNodeMaterial;
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
  const compiled = fieldNodeToWgsl(fieldNode);
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

  const uBoundsMin = uniform(
    new Vector3(min[0] - pad, min[1] - pad, min[2] - pad),
  );
  const uBoundsMax = uniform(
    new Vector3(max[0] + pad, max[1] + pad, max[2] + pad),
  );
  const uColor = uniform(color);
  const uAmbient = uniform(new Color(0xffffff).multiplyScalar(0.55));
  // Match Viewport lights (key + fill directions in world space)
  const uKeyDir = uniform(new Vector3(200, -120, 280).normalize());
  const uKeyColor = uniform(new Color(0xffffff).multiplyScalar(0.95));
  const uFillDir = uniform(new Vector3(-180, 100, 80).normalize());
  const uFillColor = uniform(new Color(0xb0c4de).multiplyScalar(0.4));
  const uMaxSteps = uniform(float(options.maxSteps ?? 128));
  const uSurfaceEps = uniform(float(options.surfaceEpsMm ?? 0.05));
  const uNormalEps = uniform(float(0.08));

  /**
   * Returns vec4(litRgb, hitT). hitT < 0 means miss (caller discards).
   *
   * IMPORTANT: three.js wgslFn treats the *first* `fn` as the callable entry
   * point (see FunctionNode). Helpers and compiled `map()` must follow.
   */
  const shadeField = wgslFn(`
fn shadeField(
  worldPos: vec3<f32>,
  cameraPos: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  baseColor: vec3<f32>,
  ambient: vec3<f32>,
  keyDir: vec3<f32>,
  keyColor: vec3<f32>,
  fillDir: vec3<f32>,
  fillColor: vec3<f32>,
  maxSteps: f32,
  surfaceEps: f32,
  normalEps: f32
) -> vec4<f32> {
  let ro = cameraPos;
  let rd = normalize(worldPos - cameraPos);

  let aabb = intersectAabb(ro, rd, boundsMin, boundsMax);
  if (aabb.z < 0.5) {
    return vec4<f32>(0.0, 0.0, 0.0, -1.0);
  }

  var t = max(aabb.x, 0.0);
  let tFar = aabb.y;
  var hitT = -1.0;
  let stepScale = 0.85;
  let maxS = i32(maxSteps);

  for (var i = 0; i < 256; i++) {
    if (i >= maxS) { break; }
    if (t > tFar) { break; }
    let p = ro + rd * t;
    let d = map(p);
    if (d < surfaceEps) {
      hitT = t;
      break;
    }
    t = t + max(d * stepScale, surfaceEps * 0.5);
  }

  if (hitT < 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, -1.0);
  }

  let pos = ro + rd * hitT;
  let n = calcNormal(pos, normalEps);
  let ndlKey = max(dot(n, normalize(keyDir)), 0.0);
  let ndlFill = max(dot(n, normalize(fillDir)), 0.0);
  let lit = ambient * baseColor
    + keyColor * baseColor * ndlKey
    + fillColor * baseColor * ndlFill;

  return vec4<f32>(lit, hitT);
}

fn intersectAabb(ro: vec3<f32>, rd: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> vec3<f32> {
  let inv = 1.0 / rd;
  let t0 = (bmin - ro) * inv;
  let t1 = (bmax - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tNear = max(max(tmin.x, tmin.y), tmin.z);
  let tFar = min(min(tmax.x, tmax.y), tmax.z);
  let hit = select(0.0, 1.0, tFar >= max(tNear, 0.0));
  return vec3<f32>(tNear, tFar, hit);
}

fn calcNormal(p: vec3<f32>, normalEps: f32) -> vec3<f32> {
  let e = normalEps;
  return normalize(vec3<f32>(
    map(p + vec3<f32>(e, 0.0, 0.0)) - map(p - vec3<f32>(e, 0.0, 0.0)),
    map(p + vec3<f32>(0.0, e, 0.0)) - map(p - vec3<f32>(0.0, e, 0.0)),
    map(p + vec3<f32>(0.0, 0.0, e)) - map(p - vec3<f32>(0.0, 0.0, e))
  ));
}

${compiled.mapSource}
`);

  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;
  material.depthTest = true;
  material.depthWrite = true;
  material.transparent = false;

  const shadeArgs = {
    worldPos: positionWorld,
    cameraPos: cameraPosition,
    boundsMin: uBoundsMin,
    boundsMax: uBoundsMax,
    baseColor: uColor,
    ambient: uAmbient,
    keyDir: uKeyDir,
    keyColor: uKeyColor,
    fillDir: uFillDir,
    fillColor: uFillColor,
    maxSteps: uMaxSteps,
    surfaceEps: uSurfaceEps,
    normalEps: uNormalEps,
  };

  material.colorNode = Fn(() => {
    // wgslFn call is typed as bare Node; result is vec4(lit, hitT).
    const shaded = shadeField(shadeArgs) as Node<"vec4">;
    If(shaded.w.lessThan(0.0), () => {
      Discard();
    });
    return shaded.xyz;
  })();

  // Surface depth (not AABB box). Second shade call — acceptable for PR1.
  material.depthNode = Fn(() => {
    const shaded = shadeField(shadeArgs) as Node<"vec4">;
    const rd = normalize(positionWorld.sub(cameraPosition));
    const hitPos = cameraPosition.add(rd.mul(shaded.w));
    const viewPos = cameraViewMatrix.mul(vec4(hitPos, 1.0));
    return viewZToPerspectiveDepth(viewPos.z, cameraNear, cameraFar);
  })();

  const mesh = new Mesh(geometry, material) as FieldRayMarchMesh;
  if (options.name) mesh.name = options.name;
  mesh.userData[RAY_MARCH_USER] = true;
  mesh.userData.fieldNode = fieldNode;
  if (fieldSolid) mesh.userData.fieldSolid = fieldSolid;
  if (options.definitionHash !== undefined) {
    mesh.userData.definitionHash = options.definitionHash;
  }
  // Store uniforms for optional live updates (lights / color).
  mesh.userData.rayMarchUniforms = {
    uColor,
    uAmbient,
    uKeyDir,
    uKeyColor,
    uFillDir,
    uFillColor,
    uBoundsMin,
    uBoundsMax,
    uMaxSteps,
    uSurfaceEps,
    uNormalEps,
  };
  mesh.frustumCulled = true;

  return mesh;
}

/** True when a mesh is a field sphere-trace display proxy. */
export function isRayMarchMesh(mesh: Mesh): boolean {
  return mesh.userData?.[RAY_MARCH_USER] === true;
}

/**
 * Legacy no-op kept for Viewport call sites.
 * Camera/projection uniforms are TSL built-ins on WebGPU; nothing to sync.
 */
export function updateRayMarchUniforms(
  _mesh: Mesh,
  _cameraPos: Vector3,
  _projectionMatrix: unknown,
  _viewMatrix: unknown,
): void {
  // Intentionally empty — WebGPU path uses cameraPosition / cameraViewMatrix nodes.
}
