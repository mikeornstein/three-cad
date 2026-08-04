/**
 * Build a Three.js Mesh that sphere-traces a FieldNode inside its AABB
 * via WebGPU / WGSL (MeshBasicNodeMaterial + TSL).
 *
 * Multi-material: leaf weights blend continuously through smooth-union.
 * Demo defaults: cube = tinted resin (volume), sphere = metal (opaque).
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
  vec3,
  vec4,
  viewZToPerspectiveDepth,
  wgslFn,
} from "three/tsl";
import type { FieldNode } from "../document/fieldDef";
import type { FieldSolid } from "../sdf";
import { fieldNodeToWgsl } from "./fieldToWgsl";
import {
  DEMO_LEAF_MATERIAL_WEIGHT,
  MAT_MACHINED_METAL,
  MAT_TINTED_RESIN,
  type FieldMaterial,
} from "./materials";

/** userData flag: this mesh is a field ray-march proxy, not a tessellation. */
export const RAY_MARCH_USER = "threeCadRayMarch";

export interface FieldRayMarchOptions {
  readonly name?: string;
  /** @deprecated Prefer material slots; kept as resin tint override. */
  readonly color?: number;
  readonly definitionHash?: string;
  /** Pad AABB (mm) so sphere-trace does not clip the surface. Default 1. */
  readonly padMm?: number;
  /** Max sphere-trace steps. Default 128. */
  readonly maxSteps?: number;
  /** Surface hit epsilon (mm). Default 0.05. */
  readonly surfaceEpsMm?: number;
  /** Material weight 0 slot (demo cube / resin). */
  readonly material0?: FieldMaterial;
  /** Material weight 1 slot (demo sphere / metal). */
  readonly material1?: FieldMaterial;
  /** leafId → weight in [0,1] for matWeight(). */
  readonly leafMaterialWeight?: Readonly<Record<string, number>>;
}

export interface FieldRayMarchMesh extends Mesh {
  material: MeshBasicNodeMaterial;
}

function colorFromRgb(rgb: readonly [number, number, number]): Color {
  return new Color(rgb[0], rgb[1], rgb[2]);
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
  const leafWeights = options.leafMaterialWeight ?? DEMO_LEAF_MATERIAL_WEIGHT;
  const mat0 = options.material0 ?? MAT_TINTED_RESIN;
  const mat1 = options.material1 ?? MAT_MACHINED_METAL;

  const compiled = fieldNodeToWgsl(fieldNode, {
    leafMaterialWeight: leafWeights,
  });
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

  const uBoundsMin = uniform(
    new Vector3(min[0] - pad, min[1] - pad, min[2] - pad),
  );
  const uBoundsMax = uniform(
    new Vector3(max[0] + pad, max[1] + pad, max[2] + pad),
  );
  const uAmbient = uniform(new Color(0xffffff).multiplyScalar(0.35));
  const uKeyDir = uniform(new Vector3(200, -120, 280).normalize());
  const uKeyColor = uniform(new Color(0xffffff).multiplyScalar(1.05));
  const uFillDir = uniform(new Vector3(-180, 100, 80).normalize());
  const uFillColor = uniform(new Color(0xb0c4de).multiplyScalar(0.35));
  const uBg = uniform(new Color(0x1a1c1e));
  const uMaxSteps = uniform(float(options.maxSteps ?? 128));
  const uSurfaceEps = uniform(float(options.surfaceEpsMm ?? 0.05));
  const uNormalEps = uniform(float(0.08));

  // Material 0 — resin (weight → 0)
  const uM0Color = uniform(
    options.color !== undefined
      ? new Color(options.color)
      : colorFromRgb(mat0.baseColor),
  );
  const uM0Rough = uniform(float(mat0.roughness));
  const uM0Metal = uniform(float(mat0.metalness));
  const uM0Trans = uniform(float(mat0.transmission));
  const uM0Ior = uniform(float(mat0.ior));
  const uM0SigmaA = uniform(vec3(...mat0.sigmaA));
  const uM0SigmaS = uniform(vec3(...mat0.sigmaS));

  // Material 1 — metal (weight → 1)
  const uM1Color = uniform(colorFromRgb(mat1.baseColor));
  const uM1Rough = uniform(float(mat1.roughness));
  const uM1Metal = uniform(float(mat1.metalness));
  const uM1Trans = uniform(float(mat1.transmission));
  const uM1Ior = uniform(float(mat1.ior));
  const uM1SigmaA = uniform(vec3(...mat1.sigmaA));
  const uM1SigmaS = uniform(vec3(...mat1.sigmaS));

  /**
   * Returns vec4(litRgb, hitT). hitT < 0 means miss.
   * First fn must be the entry point for three.js wgslFn.
   */
  const shadeField = wgslFn(`
fn shadeField(
  worldPos: vec3<f32>,
  cameraPos: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  ambient: vec3<f32>,
  keyDir: vec3<f32>,
  keyColor: vec3<f32>,
  fillDir: vec3<f32>,
  fillColor: vec3<f32>,
  bg: vec3<f32>,
  maxSteps: f32,
  surfaceEps: f32,
  normalEps: f32,
  m0Color: vec3<f32>,
  m0Rough: f32,
  m0Metal: f32,
  m0Trans: f32,
  m0Ior: f32,
  m0SigmaA: vec3<f32>,
  m0SigmaS: vec3<f32>,
  m1Color: vec3<f32>,
  m1Rough: f32,
  m1Metal: f32,
  m1Trans: f32,
  m1Ior: f32,
  m1SigmaA: vec3<f32>,
  m1SigmaS: vec3<f32>
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
  let mw = clamp(matWeight(pos), 0.0, 1.0);

  let baseColor = mix(m0Color, m1Color, mw);
  let roughness = mix(m0Rough, m1Rough, mw);
  let metalness = mix(m0Metal, m1Metal, mw);
  let transmission = mix(m0Trans, m1Trans, mw);
  let ior = mix(m0Ior, m1Ior, mw);
  let sigmaA = mix(m0SigmaA, m1SigmaA, mw);
  let sigmaS = mix(m0SigmaS, m1SigmaS, mw);

  let v = -rd;
  let nDotV = max(dot(n, v), 0.0);
  let F0 = mix(vec3<f32>(0.04), baseColor, metalness);
  let F = fresnelSchlick(nDotV, F0);

  // Specular lobe (Blinn-ish) for both materials.
  let hKey = normalize(normalize(keyDir) + v);
  let specPow = mix(64.0, 8.0, roughness);
  let specKey = pow(max(dot(n, hKey), 0.0), specPow) * keyColor;
  let ndlKey = max(dot(n, normalize(keyDir)), 0.0);
  let ndlFill = max(dot(n, normalize(fillDir)), 0.0);

  // Opaque metal path (high metalness or low transmission).
  if (metalness > 0.55 || transmission < 0.15) {
    let diff = baseColor * (ambient + keyColor * ndlKey + fillColor * ndlFill);
    let lit = mix(diff, baseColor * (specKey * 1.4 + ambient * 0.25 + fillColor * ndlFill * 0.4), metalness);
    let withSpec = lit + F * specKey * (1.0 - roughness * 0.7);
    return vec4<f32>(withSpec, hitT);
  }

  // --- Translucent / volume path (resin and blend zones) ---
  let specular = F * specKey * (1.0 - roughness * 0.5);

  // Single-scatter + Beer's law along the view ray inside the medium.
  var T = vec3<f32>(1.0);
  var Cvol = vec3<f32>(0.0);
  let volSteps = 48;
  let maxPath = 180.0; // mm
  let ds = maxPath / f32(volSteps);
  var p = pos + rd * (surfaceEps * 3.0);
  let kL = normalize(keyDir);

  for (var vi = 0; vi < 48; vi++) {
    let dIn = map(p);
    if (dIn > surfaceEps) {
      break; // exited the solid
    }

    let mwIn = clamp(matWeight(p), 0.0, 1.0);
    // Hit metal core from inside the resin — shade and stop.
    if (mwIn > 0.55) {
      let nMet = calcNormal(p, normalEps);
      let metCol = shadeMetal(nMet, rd, m1Color, ambient, keyDir, keyColor, fillDir, fillColor, m1Rough);
      Cvol = Cvol + T * metCol;
      T = vec3<f32>(0.0);
      break;
    }

    let sa = mix(m0SigmaA, m1SigmaA, mwIn);
    let ss = mix(m0SigmaS, m1SigmaS, mwIn);
    let st = sa + ss;
    let albedo = ss / max(st, vec3<f32>(1e-4));

    // Thickness toward key light (cheap transmittance for SSS).
    let thickL = thicknessToOutside(p, kL, surfaceEps, 32);
    let lightAtt = exp(-sa * thickL);
    let phase = 0.25; // isotropic-ish
    let Li = keyColor * lightAtt * phase;
    let scatter = albedo * Li * baseColor;

    let Tr = exp(-st * ds);
    // Integrate in-scatter over the segment (front-to-back).
    Cvol = Cvol + T * (vec3<f32>(1.0) - Tr) * scatter;
    T = T * Tr;

    if (max(T.x, max(T.y, T.z)) < 0.02) {
      break;
    }
    p = p + rd * ds;
  }

  // Surface diffuse contribution for slightly cloudy resin.
  let surfaceDiff = baseColor * (ambient * 0.4 + keyColor * ndlKey * 0.15 + fillColor * ndlFill * 0.1);
  let body = Cvol + T * (surfaceDiff + bg * 0.15);
  let lit = specular + (vec3<f32>(1.0) - F) * body * (0.35 + 0.65 * transmission);

  return vec4<f32>(lit, hitT);
}

fn shadeMetal(
  n: vec3<f32>,
  rd: vec3<f32>,
  baseColor: vec3<f32>,
  ambient: vec3<f32>,
  keyDir: vec3<f32>,
  keyColor: vec3<f32>,
  fillDir: vec3<f32>,
  fillColor: vec3<f32>,
  roughness: f32
) -> vec3<f32> {
  let v = -rd;
  let nDotV = max(dot(n, v), 0.0);
  let F0 = baseColor;
  let F = fresnelSchlick(nDotV, F0);
  let hKey = normalize(normalize(keyDir) + v);
  let specPow = mix(80.0, 12.0, roughness);
  let spec = pow(max(dot(n, hKey), 0.0), specPow) * keyColor;
  let ndlKey = max(dot(n, normalize(keyDir)), 0.0);
  let ndlFill = max(dot(n, normalize(fillDir)), 0.0);
  return baseColor * (ambient * 0.3 + keyColor * ndlKey * 0.35 + fillColor * ndlFill * 0.25)
    + F * spec * (1.2 - roughness * 0.6);
}

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0) - F0) * pow(1.0 - cosTheta, 5.0);
}

/** March from p along dir until outside (or max steps); returns path length in mm. */
fn thicknessToOutside(p0: vec3<f32>, dir: vec3<f32>, surfaceEps: f32, maxSteps: i32) -> f32 {
  var p = p0;
  var trav = 0.0;
  let stepScale = 0.9;
  for (var i = 0; i < 64; i++) {
    if (i >= maxSteps) { break; }
    let d = map(p);
    if (d > surfaceEps) {
      return trav;
    }
    // Inside: advance at least a bit; use -d toward surface when deep.
    let step = max(-d * stepScale, surfaceEps * 0.5);
    p = p + dir * step;
    trav = trav + step;
    if (trav > 200.0) { break; }
  }
  return trav;
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
    ambient: uAmbient,
    keyDir: uKeyDir,
    keyColor: uKeyColor,
    fillDir: uFillDir,
    fillColor: uFillColor,
    bg: uBg,
    maxSteps: uMaxSteps,
    surfaceEps: uSurfaceEps,
    normalEps: uNormalEps,
    m0Color: uM0Color,
    m0Rough: uM0Rough,
    m0Metal: uM0Metal,
    m0Trans: uM0Trans,
    m0Ior: uM0Ior,
    m0SigmaA: uM0SigmaA,
    m0SigmaS: uM0SigmaS,
    m1Color: uM1Color,
    m1Rough: uM1Rough,
    m1Metal: uM1Metal,
    m1Trans: uM1Trans,
    m1Ior: uM1Ior,
    m1SigmaA: uM1SigmaA,
    m1SigmaS: uM1SigmaS,
  };

  material.colorNode = Fn(() => {
    const shaded = shadeField(shadeArgs) as Node<"vec4">;
    If(shaded.w.lessThan(0.0), () => {
      Discard();
    });
    return shaded.xyz;
  })();

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
  mesh.userData.rayMarchUniforms = {
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
    uM0Color,
    uM1Color,
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
