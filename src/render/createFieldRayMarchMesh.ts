/**
 * Build a Three.js Mesh that sphere-traces a FieldNode inside its AABB
 * via WebGPU / WGSL (MeshBasicNodeMaterial + TSL).
 *
 * Lighting: real equirectangular HDRI (studioEnv) sampled for reflections,
 * volume irradiance, and transmission — not painted fake grids/lights.
 *
 * Transparency: residual transmittance T → mesh alpha so the real scene
 * GridHelper composites through the solid.
 */

import {
  BoxGeometry,
  Color,
  DataTexture,
  FrontSide,
  LinearFilter,
  Mesh,
  RGBAFormat,
  FloatType,
  Vector3,
  type Texture,
} from "three";
import type { Node } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Discard,
  Fn,
  If,
  cameraPosition,
  float,
  positionWorld,
  texture,
  uniform,
  vec3,
  wgslFn,
} from "three/tsl";
import type { FieldNode } from "../document/fieldDef";
import { boundsOf } from "./fieldBounds";
import {
  FIELD_HIGHLIGHT_USER,
  HIGHLIGHT_AMOUNT,
  type FieldHighlight,
  type HighlightLevel,
} from "./fieldHighlight";
import { fieldNodeToWgsl } from "./fieldToWgsl";
import { DEFAULT_LOOK, type SceneLook } from "./looks";
import {
  DEMO_LEAF_MATERIAL_WEIGHT,
  MAT_AMBER_RESIN,
  MAT_CYAN_RESIN,
  materialRimBoost,
  materialSpeckDensity,
  materialSpecularBoost,
  materialSwirl,
  type FieldMaterial,
} from "./materials";

/** userData flag: this mesh is a field ray-march proxy, not a tessellation. */
export const RAY_MARCH_USER = "threeCadRayMarch";

/** Movable sphere leaf driven by uniforms (real-time soft-min without recompile). */
export interface LiveSphereSpec {
  readonly leafId: string;
  readonly center: readonly [number, number, number] | Vector3;
  readonly radius: number;
}

/** Runtime handle to animate a live sphere (center/radius + AABB). */
export interface LiveSphereHandle {
  readonly leafId: string;
  readonly restCenter: Vector3;
  readonly restRadius: number;
  setCenter(v: Vector3 | readonly [number, number, number]): void;
  setRadius(r: number): void;
  getCenter(out?: Vector3): Vector3;
  getRadius(): number;
}

export interface FieldRayMarchOptions {
  readonly name?: string;
  /** @deprecated Prefer material slots; kept as material-0 tint override. */
  readonly color?: number;
  readonly definitionHash?: string;
  readonly padMm?: number;
  readonly maxSteps?: number;
  readonly surfaceEpsMm?: number;
  readonly material0?: FieldMaterial;
  readonly material1?: FieldMaterial;
  readonly leafMaterialWeight?: Readonly<Record<string, number>>;
  readonly look?: SceneLook;
  /**
   * Equirectangular HDR (linear). Sampled for IBL / reflections / transmission.
   * Prefer studioEnv.equirect from loadStudioEnvironment().
   */
  readonly envMap?: Texture | null;
  /** Multiplier on HDR samples. Default from look.envIntensity or 1. */
  readonly envIntensity?: number;
  /**
   * Sphere leaves whose center/radius are GPU uniforms (grab-drag, animation).
   * Smooth-union and materials re-evaluate every frame without recompiling WGSL.
   */
  readonly liveSpheres?: readonly LiveSphereSpec[];
}

export interface FieldRayMarchMesh extends Mesh {
  material: MeshBasicNodeMaterial;
}

export const LIVE_SPHERE_USER = "threeCadLiveSpheres";

/**
 * Small black float texture so the shader always has a valid env binding.
 * ≥4×4 avoids Safari/iOS WebGPU quirks with 1×1 / 2×2 textures reported in
 * other engines; values are pure black either way.
 */
let fallbackEnv: DataTexture | null = null;
function getFallbackEnv(): DataTexture {
  if (fallbackEnv) return fallbackEnv;
  const size = 4;
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 3] = 1;
  }
  fallbackEnv = new DataTexture(data, size, size, RGBAFormat, FloatType);
  fallbackEnv.magFilter = LinearFilter;
  fallbackEnv.minFilter = LinearFilter;
  fallbackEnv.needsUpdate = true;
  return fallbackEnv;
}

function colorFromRgb(rgb: readonly [number, number, number]): Color {
  return new Color(rgb[0], rgb[1], rgb[2]);
}

function vecFromTuple(t: readonly [number, number, number]): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
}

function toVec3(v: readonly [number, number, number] | Vector3): Vector3 {
  if (v instanceof Vector3) return v.clone();
  return new Vector3(v[0], v[1], v[2]);
}

/**
 * Create an AABB box mesh whose fragment shader sphere-traces `fieldNode`.
 */
export function createFieldRayMarchMesh(
  fieldNode: FieldNode,
  options: FieldRayMarchOptions = {},
): FieldRayMarchMesh {
  const leafWeights = options.leafMaterialWeight ?? DEMO_LEAF_MATERIAL_WEIGHT;
  const mat0 = options.material0 ?? MAT_CYAN_RESIN;
  const mat1 = options.material1 ?? MAT_AMBER_RESIN;
  const look = options.look ?? DEFAULT_LOOK;
  const envMap = options.envMap ?? getFallbackEnv();
  const envIntensity =
    options.envIntensity ?? look.envIntensity ?? 1.0;

  const liveSpheres = options.liveSpheres ?? [];
  const liveSphereCenters: Record<string, string> = {};
  const liveSphereRadii: Record<string, string> = {};
  const liveInitial = new Map<
    string,
    { center: Vector3; radius: number; centerParam: string; radiusParam: string }
  >();

  liveSpheres.forEach((spec, i) => {
    const suffix = liveSpheres.length === 1 ? "" : String(i);
    const centerParam = `liveSphereCenter${suffix}`;
    const radiusParam = `liveSphereRadius${suffix}`;
    liveSphereCenters[spec.leafId] = centerParam;
    liveSphereRadii[spec.leafId] = radiusParam;
    const c = toVec3(spec.center);
    liveInitial.set(spec.leafId, {
      center: c.clone(),
      radius: spec.radius,
      centerParam,
      radiusParam,
    });
  });

  const compiled = fieldNodeToWgsl(fieldNode, {
    leafMaterialWeight: leafWeights,
    liveSphereCenters:
      liveSpheres.length > 0 ? liveSphereCenters : undefined,
    liveSphereRadii: liveSpheres.length > 0 ? liveSphereRadii : undefined,
  });
  const liveDecl = compiled.liveDeclSuffix;
  const liveCall = compiled.liveCallSuffix;
  const pad = options.padMm ?? 1;
  const min = compiled.bounds.min;
  const max = compiled.bounds.max;

  const sx = Math.max(max[0] - min[0], 1e-3) + pad * 2;
  const sy = Math.max(max[1] - min[1], 1e-3) + pad * 2;
  const sz = Math.max(max[2] - min[2], 1e-3) + pad * 2;
  const cx = (min[0] + max[0]) * 0.5;
  const cy = (min[1] + max[1]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;

  // Unit box + scale/position when live spheres can leave the rest AABB.
  const useDynamicBounds = liveSpheres.length > 0;
  const geometry = useDynamicBounds
    ? new BoxGeometry(1, 1, 1)
    : new BoxGeometry(sx, sy, sz);
  if (!useDynamicBounds) {
    geometry.translate(cx, cy, cz);
  }

  const uBoundsMin = uniform(
    new Vector3(min[0] - pad, min[1] - pad, min[2] - pad),
  );
  const uBoundsMax = uniform(
    new Vector3(max[0] + pad, max[1] + pad, max[2] + pad),
  );

  // Live sphere uniforms (TSL nodes keyed by WGSL param name).
  const liveUniformArgs: Record<string, unknown> = {};
  const liveCenterUniforms = new Map<
    string,
    { value: Vector3 }
  >();
  const liveRadiusUniforms = new Map<string, { value: number }>();
  for (const [, init] of liveInitial) {
    const uC = uniform(init.center.clone());
    const uR = uniform(float(init.radius));
    liveUniformArgs[init.centerParam] = uC;
    liveUniformArgs[init.radiusParam] = uR;
    liveCenterUniforms.set(init.centerParam, uC as { value: Vector3 });
    liveRadiusUniforms.set(init.radiusParam, uR as { value: number });
  }
  const uAmbient = uniform(colorFromRgb(look.ambient));
  const uKeyDir = uniform(vecFromTuple(look.keyDir).normalize());
  const uKeyColor = uniform(colorFromRgb(look.keyColor));
  const uFillDir = uniform(vecFromTuple(look.fillDir).normalize());
  const uFillColor = uniform(colorFromRgb(look.fillColor));
  const uRimDir = uniform(vecFromTuple(look.rimDir).normalize());
  const uRimColor = uniform(colorFromRgb(look.rimColor));
  const uBg = uniform(new Color(look.background));
  const uEnvIntensity = uniform(float(envIntensity));
  const baseMaxSteps = options.maxSteps ?? look.maxSteps ?? 80;
  const baseSurfaceEps = options.surfaceEpsMm ?? look.surfaceEpsMm ?? 0.06;
  const uMaxSteps = uniform(float(baseMaxSteps));
  const uSurfaceEps = uniform(float(baseSurfaceEps));
  const uNormalEps = uniform(float(0.12));
  /** Volume integrator step budget (LOD). */
  const uVolMaxSteps = uniform(float(48));
  /** Multiplier on volume ds — >1 when zoomed in (cheaper bulk). */
  const uVolStepScale = uniform(float(1));
  /** 1 = full IBL blur, <0.55 = single-tap HDR (LOD). */
  const uIblQuality = uniform(float(1));

  const uM0Color = uniform(
    options.color !== undefined
      ? new Color(options.color)
      : colorFromRgb(mat0.baseColor),
  );
  const uM0Rough = uniform(float(mat0.roughness));
  const uM0Metal = uniform(float(mat0.metalness));
  const uM0Trans = uniform(float(mat0.transmission));
  const uM0Ior = uniform(float(mat0.ior));
  const uM0SigmaA = uniform(
    vec3(mat0.sigmaA[0], mat0.sigmaA[1], mat0.sigmaA[2]),
  );
  const uM0SigmaS = uniform(
    vec3(mat0.sigmaS[0], mat0.sigmaS[1], mat0.sigmaS[2]),
  );
  const uM0Rim = uniform(float(materialRimBoost(mat0)));
  const uM0Spec = uniform(float(materialSpecularBoost(mat0)));
  const uM0Swirl = uniform(float(materialSwirl(mat0)));
  const uM0Speck = uniform(float(materialSpeckDensity(mat0)));

  const uM1Color = uniform(colorFromRgb(mat1.baseColor));
  const uM1Rough = uniform(float(mat1.roughness));
  const uM1Metal = uniform(float(mat1.metalness));
  const uM1Trans = uniform(float(mat1.transmission));
  const uM1Ior = uniform(float(mat1.ior));
  const uM1SigmaA = uniform(
    vec3(mat1.sigmaA[0], mat1.sigmaA[1], mat1.sigmaA[2]),
  );
  const uM1SigmaS = uniform(
    vec3(mat1.sigmaS[0], mat1.sigmaS[1], mat1.sigmaS[2]),
  );
  const uM1Rim = uniform(float(materialRimBoost(mat1)));
  const uM1Spec = uniform(float(materialSpecularBoost(mat1)));
  const uM1Swirl = uniform(float(materialSwirl(mat1)));
  const uM1Speck = uniform(float(materialSpeckDensity(mat1)));
  const uHlLeaf = uniform(float(-1));
  const uHlAmount = uniform(float(0));

  // TSL texture node → WGSL texture_2d (textureLoad, no separate sampler needed).
  const envMapNode = texture(envMap);

  const fieldLib = wgslFn(`
fn fieldLibPing() -> f32 { return 0.0; }

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

fn sphereTrace(
  ro: vec3<f32>,
  rd: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  maxSteps: f32,
  surfaceEps: f32${liveDecl}
) -> f32 {
  let aabb = intersectAabb(ro, rd, boundsMin, boundsMax);
  if (aabb.z < 0.5) {
    return -1.0;
  }
  var t = max(aabb.x, 0.0);
  let tFar = aabb.y;
  let stepScale = 0.92;
  let maxS = i32(maxSteps);
  // Hard cap 128; budget is controlled by maxSteps (LOD).
  for (var i = 0; i < 128; i++) {
    if (i >= maxS) { break; }
    if (t > tFar) { break; }
    let p = ro + rd * t;
    let d = sampleField(p${liveCall}, -1.0).x;
    if (d < surfaceEps) {
      return t;
    }
    // Slightly larger min advance than 0.5·eps to avoid crawling when close.
    t = t + max(d * stepScale, surfaceEps * 0.75);
  }
  return -1.0;
}

fn calcNormal(p: vec3<f32>, normalEps: f32${liveDecl}) -> vec3<f32> {
  let e = normalEps;
  let k0 = vec3<f32>(1.0, -1.0, -1.0);
  let k1 = vec3<f32>(-1.0, 1.0, -1.0);
  let k2 = vec3<f32>(-1.0, -1.0, 1.0);
  let k3 = vec3<f32>(1.0, 1.0, 1.0);
  return normalize(
    k0 * sampleField(p + e * k0${liveCall}, -1.0).x +
    k1 * sampleField(p + e * k1${liveCall}, -1.0).x +
    k2 * sampleField(p + e * k2${liveCall}, -1.0).x +
    k3 * sampleField(p + e * k3${liveCall}, -1.0).x
  );
}

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn hash31(p: vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn valueNoise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

fn volumeSwirl(p: vec3<f32>, amount: f32) -> f32 {
  if (amount < 0.001) {
    return 1.0;
  }
  let q = p * 0.028;
  let n1 = valueNoise3(q);
  let warped = q + vec3<f32>(n1 * 3.2, n1 * -2.4, n1 * 2.0);
  let n2 = valueNoise3(warped * 1.55 + vec3<f32>(3.1, 1.7, 9.2));
  let n3 = valueNoise3(warped * 2.8 + vec3<f32>(n2 * 2.5, 4.2, 0.5));
  let n4 = valueNoise3(warped.yzx * 4.5 + vec3<f32>(1.2, n3, 7.7));
  let raw = n2 * 0.55 + n3 * 0.3 + n4 * 0.2;
  let bands = smoothstep(0.25, 0.85, raw);
  let swirl = mix(0.2, 2.15, bands);
  return mix(1.0, swirl, amount);
}

/**
 * Fine, hard flecks suspended evenly through the volume (not surface dirt).
 * One particle per occupied cell; sharp radial falloff for defined grains.
 * Returns strength in [0,1].
 */
fn volumeSpecks(p: vec3<f32>, density: f32) -> f32 {
  if (density < 0.001) {
    return 0.0;
  }
  // Fine grain ~2 mm cells; occupancy scales with density.
  let cell = 2.15;
  let g = floor(p / cell);
  let f = fract(p / cell) - vec3<f32>(0.5);
  let seed = hash31(g + vec3<f32>(17.1, 9.3, 3.7));
  // density 1 → ~18% cells occupied — even field of small flecks.
  let thresh = 1.0 - density * 0.18;
  if (seed < thresh) {
    return 0.0;
  }
  // Jitter center inside cell.
  let ox = hash31(g + vec3<f32>(1.3, 4.7, 2.1)) - 0.5;
  let oy = hash31(g + vec3<f32>(8.2, 1.9, 5.5)) - 0.5;
  let oz = hash31(g + vec3<f32>(3.4, 6.6, 0.8)) - 0.5;
  let local = f - vec3<f32>(ox, oy, oz) * 0.35;
  let r = length(local);
  // Radius ~0.12–0.22 cell units (~0.25–0.5 mm) — fine, defined grain.
  let rad = 0.11 + 0.1 * hash31(g + vec3<f32>(0.7, 2.2, 9.1));
  // Hard-ish disc with slight soft edge (not a haze blob, not a sparkle).
  return 1.0 - smoothstep(rad * 0.55, rad, r);
}

/**
 * Z-up world → Y-up equirect space.
 * Matches Scene.backgroundRotation / environmentRotation of Rx(+90°):
 *   (x, y, z)_zup → (x, −z, y)_yup so world +Z (ceiling) = HDR +Y, right-side up.
 */
fn zUpToYUp(d: vec3<f32>) -> vec3<f32> {
  return normalize(vec3<f32>(d.x, -d.z, d.y));
}

/**
 * Bilinear equirectangular HDR sample via textureLoad (no sampler required).
 * dir is Z-up world space.
 */
fn sampleHDR(
  map: texture_2d<f32>,
  dirZup: vec3<f32>,
  intensity: f32
) -> vec3<f32> {
  let d = zUpToYUp(dirZup);
  let u = atan2(d.z, d.x) * 0.15915494309189535 + 0.5;
  let v = 1.0 - (asin(clamp(d.y, -1.0, 1.0)) * 0.3183098861837907 + 0.5);
  let dims = vec2<f32>(textureDimensions(map));
  let coord = vec2<f32>(u, v) * dims - vec2<f32>(0.5);
  let i0 = vec2<i32>(floor(coord));
  let f = fract(coord);
  let maxC = vec2<i32>(textureDimensions(map)) - vec2<i32>(1);
  let p00 = clamp(i0, vec2<i32>(0), maxC);
  let p10 = clamp(i0 + vec2<i32>(1, 0), vec2<i32>(0), maxC);
  let p01 = clamp(i0 + vec2<i32>(0, 1), vec2<i32>(0), maxC);
  let p11 = clamp(i0 + vec2<i32>(1, 1), vec2<i32>(0), maxC);
  let c00 = textureLoad(map, p00, 0).rgb;
  let c10 = textureLoad(map, p10, 0).rgb;
  let c01 = textureLoad(map, p01, 0).rgb;
  let c11 = textureLoad(map, p11, 0).rgb;
  let c0 = mix(c00, c10, f.x);
  let c1 = mix(c01, c11, f.x);
  let c = mix(c0, c1, f.y);
  return max(c, vec3<f32>(0.0)) * intensity;
}

/** Cheap blur: average a few offsets for rough specular / diffuse IBL. */
fn sampleHDRBlur(
  map: texture_2d<f32>,
  dirZup: vec3<f32>,
  intensity: f32,
  spread: f32
) -> vec3<f32> {
  let d = normalize(dirZup);
  var acc = sampleHDR(map, d, intensity);
  acc = acc + sampleHDR(map, normalize(d + vec3<f32>(spread, 0.0, 0.0)), intensity);
  acc = acc + sampleHDR(map, normalize(d + vec3<f32>(-spread, 0.0, 0.0)), intensity);
  acc = acc + sampleHDR(map, normalize(d + vec3<f32>(0.0, spread, 0.0)), intensity);
  acc = acc + sampleHDR(map, normalize(d + vec3<f32>(0.0, -spread, 0.0)), intensity);
  acc = acc + sampleHDR(map, normalize(d + vec3<f32>(0.0, 0.0, spread)), intensity);
  return acc * (1.0 / 6.0);
}

fn tonemap(c: vec3<f32>) -> vec3<f32> {
  let x = max(c, vec3<f32>(0.0));
  // Reinhard-ish — preserves color, kills HDR white blowout.
  return x / (x + vec3<f32>(0.85));
}

${compiled.mapSource}
`);

  const shadeField = wgslFn(
    `
fn shadeField(
  worldPos: vec3<f32>,
  cameraPos: vec3<f32>,
  hitT: f32,
  ambient: vec3<f32>,
  keyDir: vec3<f32>,
  keyColor: vec3<f32>,
  fillDir: vec3<f32>,
  fillColor: vec3<f32>,
  rimDir: vec3<f32>,
  rimColor: vec3<f32>,
  bg: vec3<f32>,
  envIntensity: f32,
  surfaceEps: f32,
  normalEps: f32,
  volMaxSteps: f32,
  volStepScale: f32,
  iblQuality: f32,
  m0Color: vec3<f32>,
  m0Rough: f32,
  m0Metal: f32,
  m0Trans: f32,
  m0Ior: f32,
  m0SigmaA: vec3<f32>,
  m0SigmaS: vec3<f32>,
  m0Rim: f32,
  m0Spec: f32,
  m0Swirl: f32,
  m0Speck: f32,
  m1Color: vec3<f32>,
  m1Rough: f32,
  m1Metal: f32,
  m1Trans: f32,
  m1Ior: f32,
  m1SigmaA: vec3<f32>,
  m1SigmaS: vec3<f32>,
  m1Rim: f32,
  m1Spec: f32,
  m1Swirl: f32,
  m1Speck: f32,
  hlLeaf: f32,
  highlightAmount: f32,
  envMap: texture_2d<f32>${liveDecl}
) -> vec4<f32> {
  let ro = cameraPos;
  let rd = normalize(worldPos - cameraPos);

  // hitT is shared with depthNode — one sphereTrace per fragment.
  if (hitT < 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, -1.0);
  }

  let pos = ro + rd * hitT;
  let n = calcNormal(pos, normalEps${liveCall});
  let s0 = sampleField(pos${liveCall}, hlLeaf);
  let mw = clamp(s0.y, 0.0, 1.0);
  let wake = clamp(s0.z, 0.0, 1.0) * clamp(highlightAmount, 0.0, 1.0);

  let baseColor = mix(m0Color, m1Color, mw);
  let roughness = mix(m0Rough, m1Rough, mw);
  let metalness = mix(m0Metal, m1Metal, mw);
  let transmission = mix(m0Trans, m1Trans, mw);
  let rimBoost = mix(m0Rim, m1Rim, mw) * mix(1.0, 4.2, wake);
  let specBoost = mix(m0Spec, m1Spec, mw) * mix(1.0, 2.6, wake);

  let v = -rd;
  let nDotV = max(dot(n, v), 0.0);
  let ior = mix(m0Ior, m1Ior, mw);
  let f0d = pow((ior - 1.0) / (ior + 1.0), 2.0);
  let F0 = mix(vec3<f32>(f0d), baseColor, metalness);
  let F = fresnelSchlick(nDotV, F0);

  // --- Real IBL from HDR equirect (blur is LOD-gated when zoomed in) ---
  let R = reflect(rd, n);
  let envSpread = mix(0.03, 0.2, roughness);
  var envSpec: vec3<f32>;
  var envDiff: vec3<f32>;
  if (iblQuality < 0.55) {
    envSpec = sampleHDR(envMap, R, envIntensity * 0.85);
    envDiff = sampleHDR(envMap, n, envIntensity * 0.3);
  } else {
    envSpec = sampleHDRBlur(envMap, R, envIntensity * 0.85, envSpread);
    envDiff = sampleHDRBlur(envMap, n, envIntensity * 0.3, 0.4);
  }
  let refrDir = refract(rd, n, 1.0 / ior);
  let thruDir = select(rd, normalize(refrDir), length(refrDir) > 0.01);
  let envThru = sampleHDR(envMap, thruDir, envIntensity * 0.5);

  let kDir = normalize(keyDir);
  let fDir = normalize(fillDir);
  let rDir = normalize(rimDir);
  let ndlKey = max(dot(n, kDir), 0.0);
  let ndlFill = max(dot(n, fDir), 0.0);
  let ndlRim = max(dot(n, rDir), 0.0);
  let hKey = normalize(kDir + v);
  let specPow = mix(120.0, 24.0, roughness);
  let specKey = pow(max(dot(n, hKey), 0.0), specPow) * keyColor;

  let graze = clamp(1.0 - nDotV, 0.0, 1.0);
  let fresnelRim = pow(graze, 3.0);

  if (metalness > 0.7 && transmission < 0.2) {
    let diff = baseColor * (ambient + envDiff * 0.8 + keyColor * ndlKey * 0.35);
    let lit = mix(diff, baseColor * envSpec * 1.2, metalness);
    let metalWake = baseColor * fresnelRim * wake * 0.7;
    return vec4<f32>(tonemap(lit + F * envSpec * specBoost + metalWake), 1.0);
  }

  // Clear glass specular (moderate, not milky).
  let specular = F * envSpec * (0.7 * specBoost) + F * specKey * 0.12 * specBoost;
  let edgeCore = pow(graze, 5.2);
  let rimTint = mix(baseColor * 1.15, vec3<f32>(0.3, 0.75, 1.0), 0.35);
  let rim = rimTint * (fresnelRim * 0.55 + edgeCore * 1.0) * rimBoost;
  let rimLight = rimColor * fresnelRim * ndlRim * rimBoost * 0.15;

  // Clear volume + fine flecks through the bulk.
  // When volMaxSteps is low (zoomed-in LOD), skip swirl/specks and take large steps —
  // full-screen glass volume is the dominant cost close up.
  var T = vec3<f32>(1.0);
  var Cvol = vec3<f32>(0.0);
  var p = pos + rd * (surfaceEps * 4.0);
  let stepMul = max(volStepScale, 0.75);
  let cheapVol = volMaxSteps < 22.0;
  let minDs = select(0.45, 1.6, cheapVol) * stepMul;
  let maxDs = select(2.8, 8.0, cheapVol) * stepMul;
  let maxPath = select(160.0, 90.0, cheapVol);
  var pathLen = 0.0;
  let maxVol = i32(volMaxSteps);

  for (var vi = 0; vi < 48; vi++) {
    if (vi >= maxVol) { break; }
    let s = sampleField(p${liveCall}, hlLeaf);
    if (s.x > surfaceEps) {
      break;
    }

    let w = clamp(s.y, 0.0, 1.0);
    let col = mix(m0Color, m1Color, w);
    let sa = mix(m0SigmaA, m1SigmaA, w);
    let ss = mix(m0SigmaS, m1SigmaS, w);
    let localSwirl = mix(m0Swirl, m1Swirl, w);
    let localSpeck = mix(m0Speck, m1Speck, w);
    // Procedural swirl is 4× noise — drop it under zoom LOD.
    let dens = select(volumeSwirl(p, localSwirl), 1.0, cheapVol);
    let saD = sa * mix(1.0, dens, 0.15);
    let ssD = ss * dens;
    let st = saD + ssD;
    let albedo = ssD / max(st, vec3<f32>(1e-4));

    let ds = clamp(max(-s.x, surfaceEps) * 0.25 + minDs * 0.55, minDs, maxDs);

    let depthIn = max(-s.x, 0.0);
    let interior = smoothstep(0.6, 2.2, depthIn);

    let thickL = depthIn * 2.0;
    let lightAtt = exp(-saD * thickL);
    let Li =
      envDiff * lightAtt * 0.7 +
      keyColor * ndlKey * lightAtt * 0.25 +
      fillColor * ndlFill * 0.15 +
      ambient * 0.2;
    var scatter = albedo * Li * col * (0.3 + 0.35 * dens);

    // Specks only at full quality — cell hash is extra cost per step.
    var sp = 0.0;
    if (!cheapVol) {
      sp = volumeSpecks(p, localSpeck) * interior;
      if (sp > 0.04) {
        let tone = hash31(floor(p / 2.15) + vec3<f32>(2.0, 5.0, 1.0));
        let fleckCol = col * mix(0.55, 1.15, tone);
        let fleckLit = fleckCol * (Li * 0.9 + ambient * 0.25);
        scatter = scatter + fleckLit * sp * 1.8;
        T = T * (1.0 - sp * 0.35);
      }
    }

    let Tr = exp(-st * ds);
    Cvol = Cvol + T * (vec3<f32>(1.0) - Tr) * scatter;
    if (!cheapVol && sp > 0.04) {
      let tone2 = hash31(floor(p / 2.15) + vec3<f32>(9.0, 1.0, 4.0));
      let grain = col * mix(0.5, 1.1, tone2) * (Li * 0.85 + ambient * 0.2);
      Cvol = Cvol + T * grain * sp * 0.55;
    }
    T = T * Tr;
    pathLen = pathLen + ds;

    if (max(T.x, max(T.y, T.z)) < 0.02) {
      break;
    }
    p = p + rd * ds;
    if (pathLen > maxPath) {
      break;
    }
  }

  // Clear body: residual transmittance + light volume + flecks already in Cvol.
  let beer = exp(-mix(m0SigmaA, m1SigmaA, mw) * max(pathLen, 6.0));
  let bodyTint = baseColor * (0.25 + 0.5 * (1.0 - beer));
  let thru = T * (envThru * beer * 0.45 + bodyTint * 0.3 + bg * 0.06);
  let glass = (vec3<f32>(1.0) - F * 0.5) * (Cvol + thru) * mix(0.25, 1.0, transmission);

  let specAtten = mix(0.45, 1.0, fresnelRim * 0.4 + 0.4);
  // Material-agnostic wake: lift existing rim/spec and add a base-tinted
  // Fresnel so metal / opaque leaves read as well as glass.
  let wakeRim = baseColor * (fresnelRim * 0.55 + edgeCore * 0.35) * wake * 0.85;
  let wakeSpec = F * envSpec * wake * 0.45;
  let emit = specular * specAtten + glass + rim + rimLight + wakeRim + wakeSpec;

  let Tavg = (T.x + T.y + T.z) * (1.0 / 3.0);
  let alpha = clamp(1.0 - Tavg * transmission * 0.8, 0.12, 0.88);
  let src = min(emit / max(alpha, 0.25), vec3<f32>(2.2));
  return vec4<f32>(tonemap(src), alpha);
}
`,
    [fieldLib as never],
  );

  const hitDepth = wgslFn(
    `
fn hitDepth(
  worldPos: vec3<f32>,
  cameraPos: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  maxSteps: f32,
  surfaceEps: f32${liveDecl}
) -> f32 {
  let ro = cameraPos;
  let rd = normalize(worldPos - cameraPos);
  return sphereTrace(ro, rd, boundsMin, boundsMax, maxSteps, surfaceEps${liveCall});
}
`,
    [fieldLib as never],
  );

  const material = new MeshBasicNodeMaterial();
  material.side = FrontSide;
  material.depthTest = true;
  material.depthWrite = true;
  material.transparent = true;

  // One sphere-trace per fragment — shared by shade + depth (TSL CSE).
  const hitT = hitDepth({
    worldPos: positionWorld,
    cameraPos: cameraPosition,
    boundsMin: uBoundsMin,
    boundsMax: uBoundsMax,
    maxSteps: uMaxSteps,
    surfaceEps: uSurfaceEps,
    ...liveUniformArgs,
  }) as Node<"float">;

  const shadeArgs = {
    worldPos: positionWorld,
    cameraPos: cameraPosition,
    hitT,
    ambient: uAmbient,
    keyDir: uKeyDir,
    keyColor: uKeyColor,
    fillDir: uFillDir,
    fillColor: uFillColor,
    rimDir: uRimDir,
    rimColor: uRimColor,
    bg: uBg,
    envIntensity: uEnvIntensity,
    surfaceEps: uSurfaceEps,
    normalEps: uNormalEps,
    volMaxSteps: uVolMaxSteps,
    volStepScale: uVolStepScale,
    iblQuality: uIblQuality,
    m0Color: uM0Color,
    m0Rough: uM0Rough,
    m0Metal: uM0Metal,
    m0Trans: uM0Trans,
    m0Ior: uM0Ior,
    m0SigmaA: uM0SigmaA,
    m0SigmaS: uM0SigmaS,
    m0Rim: uM0Rim,
    m0Spec: uM0Spec,
    m0Swirl: uM0Swirl,
    m0Speck: uM0Speck,
    m1Color: uM1Color,
    m1Rough: uM1Rough,
    m1Metal: uM1Metal,
    m1Trans: uM1Trans,
    m1Ior: uM1Ior,
    m1SigmaA: uM1SigmaA,
    m1SigmaS: uM1SigmaS,
    m1Rim: uM1Rim,
    m1Spec: uM1Spec,
    m1Swirl: uM1Swirl,
    m1Speck: uM1Speck,
    hlLeaf: uHlLeaf,
    highlightAmount: uHlAmount,
    envMap: envMapNode,
    ...liveUniformArgs,
  };

  const shaded = shadeField(shadeArgs) as Node<"vec4">;

  material.colorNode = Fn(() => {
    If(shaded.w.lessThan(0.0), () => {
      Discard();
    });
    return shaded.xyz;
  })();

  material.opacityNode = Fn(() => {
    return shaded.w.max(float(0.0));
  })();

  // No custom depthNode: a second sphere-trace (or depth prepass) doubles surface cost.
  // Misses already Discard() in colorNode so drill holes do not write depth; hit pixels
  // use the AABB proxy depth which is fine for the current single-solid viewport.

  const mesh = new Mesh(geometry, material) as FieldRayMarchMesh;
  if (options.name) mesh.name = options.name;
  mesh.userData[RAY_MARCH_USER] = true;
  mesh.userData.fieldNode = fieldNode;
  if (options.definitionHash !== undefined) {
    mesh.userData.definitionHash = options.definitionHash;
  }
  mesh.userData.lookId = look.id;
  mesh.userData[FIELD_HIGHLIGHT_USER] = createFieldHighlight(
    compiled.leafIds,
    uHlLeaf as { value: number },
    uHlAmount as { value: number },
  );
  mesh.userData.fieldHighlight = mesh.userData[FIELD_HIGHLIGHT_USER];
  mesh.userData.rayMarchBase = {
    maxSteps: baseMaxSteps,
    surfaceEpsMm: baseSurfaceEps,
  };
  mesh.userData.rayMarchUniforms = {
    uAmbient,
    uKeyDir,
    uKeyColor,
    uFillDir,
    uFillColor,
    uRimDir,
    uRimColor,
    uEnvIntensity,
    uBoundsMin,
    uBoundsMax,
    uMaxSteps,
    uSurfaceEps,
    uNormalEps,
    uVolMaxSteps,
    uVolStepScale,
    uIblQuality,
    uM0Color,
    uM1Color,
  };

  if (useDynamicBounds) {
    applyProxyBounds(mesh, uBoundsMin, uBoundsMax, min, max, pad);
    const handles: LiveSphereHandle[] = [];
    for (const [leafId, init] of liveInitial) {
      const centerU = liveCenterUniforms.get(init.centerParam)!;
      const radiusU = liveRadiusUniforms.get(init.radiusParam)!;
      const restCenter = init.center.clone();
      const restRadius = init.radius;
      const handle: LiveSphereHandle = {
        leafId,
        restCenter,
        restRadius,
        setCenter(v) {
          const c = toVec3(v);
          centerU.value.copy(c);
          refreshLiveBounds(
            mesh,
            fieldNode,
            liveInitial,
            liveCenterUniforms,
            liveRadiusUniforms,
            uBoundsMin,
            uBoundsMax,
            pad,
          );
        },
        setRadius(r) {
          radiusU.value = Math.max(r, 1e-4);
          refreshLiveBounds(
            mesh,
            fieldNode,
            liveInitial,
            liveCenterUniforms,
            liveRadiusUniforms,
            uBoundsMin,
            uBoundsMax,
            pad,
          );
        },
        getCenter(out = new Vector3()) {
          return out.copy(centerU.value);
        },
        getRadius() {
          return radiusU.value;
        },
      };
      handles.push(handle);
    }
    mesh.userData[LIVE_SPHERE_USER] = handles;
    // Convenience: primary (first) live sphere.
    mesh.userData.liveSphere = handles[0];
  }

  mesh.frustumCulled = true;

  return mesh;
}

function applyProxyBounds(
  mesh: Mesh,
  uBoundsMin: { value: Vector3 },
  uBoundsMax: { value: Vector3 },
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  pad: number,
): void {
  const bmin = new Vector3(min[0] - pad, min[1] - pad, min[2] - pad);
  const bmax = new Vector3(max[0] + pad, max[1] + pad, max[2] + pad);
  uBoundsMin.value.copy(bmin);
  uBoundsMax.value.copy(bmax);
  const size = new Vector3().subVectors(bmax, bmin);
  const center = new Vector3().addVectors(bmin, bmax).multiplyScalar(0.5);
  mesh.position.copy(center);
  mesh.scale.set(
    Math.max(size.x, 1e-3),
    Math.max(size.y, 1e-3),
    Math.max(size.z, 1e-3),
  );
  mesh.updateMatrixWorld(true);
}

function refreshLiveBounds(
  mesh: Mesh,
  fieldNode: FieldNode,
  liveInitial: Map<
    string,
    { center: Vector3; radius: number; centerParam: string; radiusParam: string }
  >,
  liveCenterUniforms: Map<string, { value: Vector3 }>,
  liveRadiusUniforms: Map<string, { value: number }>,
  uBoundsMin: { value: Vector3 },
  uBoundsMax: { value: Vector3 },
  pad: number,
): void {
  const patched = patchLiveSpheres(fieldNode, (leafId, node) => {
    const init = liveInitial.get(leafId);
    if (!init) return node;
    const cU = liveCenterUniforms.get(init.centerParam);
    const rU = liveRadiusUniforms.get(init.radiusParam);
    const c = cU?.value ?? init.center;
    const r = rU?.value ?? init.radius;
    return {
      ...node,
      center: [c.x, c.y, c.z] as const,
      radius: r,
    };
  });
  const b = boundsOf(patched);
  applyProxyBounds(mesh, uBoundsMin, uBoundsMax, b.min, b.max, pad);
}

function patchLiveSpheres(
  node: FieldNode,
  patch: (
    leafId: string,
    sphere: Extract<FieldNode, { op: "sphere" }>,
  ) => FieldNode,
): FieldNode {
  switch (node.op) {
    case "sphere":
      return node.leafId ? patch(node.leafId, node) : node;
    case "box":
    case "cylinder":
      return node;
    case "union":
    case "intersection":
    case "difference":
    case "smoothUnion":
      return {
        ...node,
        a: patchLiveSpheres(node.a, patch),
        b: patchLiveSpheres(node.b, patch),
      };
    case "translate":
    case "offset":
      return {
        ...node,
        solid: patchLiveSpheres(node.solid, patch),
      };
    default: {
      const _e: never = node;
      return _e;
    }
  }
}

function createFieldHighlight(
  leafIds: readonly string[],
  uLeaf: { value: number },
  uAmount: { value: number },
): FieldHighlight {
  let target: string | null = null;
  let amount = 0;
  return {
    leafIds,
    setTarget(leafId) {
      target = leafId;
      uLeaf.value = leafId === null ? -1 : leafIds.indexOf(leafId);
    },
    getTarget() {
      return target;
    },
    setAmount(next) {
      amount = Math.min(1, Math.max(0, next));
      uAmount.value = amount;
    },
    getAmount() {
      return amount;
    },
    setLevel(level: HighlightLevel) {
      this.setAmount(HIGHLIGHT_AMOUNT[level]);
    },
  };
}

export function isRayMarchMesh(mesh: Mesh): boolean {
  return mesh.userData?.[RAY_MARCH_USER] === true;
}

/** TSL float uniform value holder. */
type FloatUniform = { value: number };

export interface RayMarchUniformBag {
  uMaxSteps?: FloatUniform;
  uSurfaceEps?: FloatUniform;
  uNormalEps?: FloatUniform;
  uVolMaxSteps?: FloatUniform;
  uVolStepScale?: FloatUniform;
  uIblQuality?: FloatUniform;
}

/**
 * Map quality onto sphere-trace / volume / IBL LOD uniforms.
 *
 * Surface (qS) and volume (qV) are separate: close-up zoom must cheapen
 * the volume integrator without coarsening the hit / normals / IBL (that
 * reads as a resolution drop). qV < ~0.45 takes the cheap volume path
 * (no swirl/specks, large steps).
 */
export function applyRayMarchQuality(
  mesh: Mesh,
  surfaceQuality: number,
  volumeQuality: number = surfaceQuality,
): void {
  if (!isRayMarchMesh(mesh)) return;
  const u = mesh.userData.rayMarchUniforms as RayMarchUniformBag | undefined;
  if (!u) return;
  const base = mesh.userData.rayMarchBase as
    | { maxSteps: number; surfaceEpsMm: number }
    | undefined;
  const qS = Math.min(1, Math.max(0.7, surfaceQuality));
  const qV = Math.min(1, Math.max(0.12, volumeQuality));
  const baseSteps = base?.maxSteps ?? 80;
  const baseEps = base?.surfaceEpsMm ?? 0.06;

  if (u.uMaxSteps) {
    // Close-up still needs enough steps for thin walls / drill rims.
    u.uMaxSteps.value = Math.min(128, Math.round(baseSteps * (0.7 + 0.3 * qS)));
  }
  if (u.uSurfaceEps) {
    u.uSurfaceEps.value = baseEps * (1.35 - 0.35 * qS);
  }
  if (u.uVolMaxSteps) {
    // Floor at 8 — cheap path threshold in shader is volMaxSteps < 22.
    u.uVolMaxSteps.value = Math.min(48, Math.round(8 + 40 * qV));
  }
  if (u.uVolStepScale) {
    u.uVolStepScale.value = 3.2 - 2.2 * qV;
  }
  if (u.uIblQuality) {
    u.uIblQuality.value = qS;
  }
  if (u.uNormalEps) {
    u.uNormalEps.value = 0.12 * (1.2 - 0.2 * qS);
  }
}

/** @deprecated Prefer applyRayMarchQuality — kept for call-site compatibility. */
export function updateRayMarchUniforms(
  mesh: Mesh,
  _cameraPos: Vector3,
  _projectionMatrix: unknown,
  _viewMatrix: unknown,
): void {
  applyRayMarchQuality(mesh, 1);
}
