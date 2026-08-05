/**
 * Build a Three.js Mesh that sphere-traces a FieldNode inside its AABB
 * via WebGPU / WGSL (MeshBasicNodeMaterial + TSL).
 *
 * Multi-material: leaf weights blend continuously through smooth-union.
 * Demo defaults: cyan resin cube + amber resin sphere (dual transparent gradient).
 *
 * Look-dev: materials + lighting aim for glass/resin product stills (refs/).
 * Performance: depth = sphere-trace only; volume uses adaptive steps and a
 * free SDF thickness proxy (no nested light rays). Target ≥20 FPS.
 *
 * WGSL layout: shared helper FunctionNode included by both shade + depth entry
 * points so Three.js does not redeclare sampleField / sdBox / etc.
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
import { fieldNodeToWgsl } from "./fieldToWgsl";
import {
  DEFAULT_LOOK,
  type SceneLook,
} from "./looks";
import {
  DEMO_LEAF_MATERIAL_WEIGHT,
  MAT_AMBER_RESIN,
  MAT_CYAN_RESIN,
  materialRimBoost,
  materialSpecularBoost,
  materialSwirl,
  type FieldMaterial,
} from "./materials";

/** userData flag: this mesh is a field ray-march proxy, not a tessellation. */
export const RAY_MARCH_USER = "threeCadRayMarch";

export interface FieldRayMarchOptions {
  readonly name?: string;
  /** @deprecated Prefer material slots; kept as material-0 tint override. */
  readonly color?: number;
  readonly definitionHash?: string;
  /** Pad AABB (mm) so sphere-trace does not clip the surface. Default 1. */
  readonly padMm?: number;
  /** Max sphere-trace steps. Default from look or 80. */
  readonly maxSteps?: number;
  /** Surface hit epsilon (mm). Default from look or 0.06. */
  readonly surfaceEpsMm?: number;
  /** Material weight 0 slot (demo cube / cyan resin). */
  readonly material0?: FieldMaterial;
  /** Material weight 1 slot (demo sphere / amber resin). */
  readonly material1?: FieldMaterial;
  /** leafId → weight in [0,1] for matWeight(). */
  readonly leafMaterialWeight?: Readonly<Record<string, number>>;
  /** Scene lighting / quality defaults for the field shader. */
  readonly look?: SceneLook;
}

export interface FieldRayMarchMesh extends Mesh {
  material: MeshBasicNodeMaterial;
}

function colorFromRgb(rgb: readonly [number, number, number]): Color {
  return new Color(rgb[0], rgb[1], rgb[2]);
}

function vecFromTuple(t: readonly [number, number, number]): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
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
  const uAmbient = uniform(colorFromRgb(look.ambient));
  const uKeyDir = uniform(vecFromTuple(look.keyDir).normalize());
  const uKeyColor = uniform(colorFromRgb(look.keyColor));
  const uFillDir = uniform(vecFromTuple(look.fillDir).normalize());
  const uFillColor = uniform(colorFromRgb(look.fillColor));
  const uRimDir = uniform(vecFromTuple(look.rimDir).normalize());
  const uRimColor = uniform(colorFromRgb(look.rimColor));
  const uBg = uniform(new Color(look.background));
  const uMaxSteps = uniform(
    float(options.maxSteps ?? look.maxSteps ?? 80),
  );
  const uSurfaceEps = uniform(
    float(options.surfaceEpsMm ?? look.surfaceEpsMm ?? 0.06),
  );
  const uNormalEps = uniform(float(0.12));

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

  // Shared WGSL library — first fn is the include "entry"; callers use helpers by name.
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
  surfaceEps: f32
) -> f32 {
  let aabb = intersectAabb(ro, rd, boundsMin, boundsMax);
  if (aabb.z < 0.5) {
    return -1.0;
  }
  var t = max(aabb.x, 0.0);
  let tFar = aabb.y;
  let stepScale = 0.9;
  let maxS = i32(maxSteps);
  for (var i = 0; i < 96; i++) {
    if (i >= maxS) { break; }
    if (t > tFar) { break; }
    let p = ro + rd * t;
    let d = sampleField(p).x;
    if (d < surfaceEps) {
      return t;
    }
    t = t + max(d * stepScale, surfaceEps * 0.5);
  }
  return -1.0;
}

/** Tetrahedral gradient — 4 field samples instead of 6. */
fn calcNormal(p: vec3<f32>, normalEps: f32) -> vec3<f32> {
  let e = normalEps;
  let k0 = vec3<f32>(1.0, -1.0, -1.0);
  let k1 = vec3<f32>(-1.0, 1.0, -1.0);
  let k2 = vec3<f32>(-1.0, -1.0, 1.0);
  let k3 = vec3<f32>(1.0, 1.0, 1.0);
  return normalize(
    k0 * sampleField(p + e * k0).x +
    k1 * sampleField(p + e * k1).x +
    k2 * sampleField(p + e * k2).x +
    k3 * sampleField(p + e * k3).x
  );
}

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

/** Cheap hash → value noise for volume swirl (look-dev amber). */
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

/** Domain-warped swirl in [~0.15, ~2.2] for volumetric density modulation. */
fn volumeSwirl(p: vec3<f32>, amount: f32) -> f32 {
  if (amount < 0.001) {
    return 1.0;
  }
  // Scale for ~100 mm parts: a few large swirls across the sphere.
  let q = p * 0.028;
  let n1 = valueNoise3(q);
  let warped = q + vec3<f32>(n1 * 3.2, n1 * -2.4, n1 * 2.0);
  let n2 = valueNoise3(warped * 1.55 + vec3<f32>(3.1, 1.7, 9.2));
  let n3 = valueNoise3(warped * 2.8 + vec3<f32>(n2 * 2.5, 4.2, 0.5));
  let n4 = valueNoise3(warped.yzx * 4.5 + vec3<f32>(1.2, n3, 7.7));
  // High contrast bands like molten amber in mat_ref_01.
  let raw = n2 * 0.55 + n3 * 0.3 + n4 * 0.2;
  let bands = smoothstep(0.25, 0.85, raw);
  let swirl = mix(0.2, 2.15, bands);
  return mix(1.0, swirl, amount);
}

/** Mild filmic curve — preserves deep glass blues, lets specular hotspots pop. */
fn tonemap(c: vec3<f32>) -> vec3<f32> {
  let x = max(c, vec3<f32>(0.0));
  // ACES-inspired rational; less mid lift than prior curve.
  let a = x * (x + 0.024) * 2.51;
  let b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / b, vec3<f32>(0.0), vec3<f32>(1.6));
}

${compiled.mapSource}
`);

  const shadeField = wgslFn(
    `
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
  rimDir: vec3<f32>,
  rimColor: vec3<f32>,
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
  m0Rim: f32,
  m0Spec: f32,
  m0Swirl: f32,
  m1Color: vec3<f32>,
  m1Rough: f32,
  m1Metal: f32,
  m1Trans: f32,
  m1Ior: f32,
  m1SigmaA: vec3<f32>,
  m1SigmaS: vec3<f32>,
  m1Rim: f32,
  m1Spec: f32,
  m1Swirl: f32
) -> vec4<f32> {
  let ro = cameraPos;
  let rd = normalize(worldPos - cameraPos);

  let hitT = sphereTrace(ro, rd, boundsMin, boundsMax, maxSteps, surfaceEps);
  if (hitT < 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, -1.0);
  }

  let pos = ro + rd * hitT;
  let n = calcNormal(pos, normalEps);
  let s0 = sampleField(pos);
  let mw = clamp(s0.y, 0.0, 1.0);

  let baseColor = mix(m0Color, m1Color, mw);
  let roughness = mix(m0Rough, m1Rough, mw);
  let metalness = mix(m0Metal, m1Metal, mw);
  let transmission = mix(m0Trans, m1Trans, mw);
  let rimBoost = mix(m0Rim, m1Rim, mw);
  let specBoost = mix(m0Spec, m1Spec, mw);
  let swirlAmt = mix(m0Swirl, m1Swirl, mw);

  let v = -rd;
  let nDotV = max(dot(n, v), 0.0);
  // Dielectric F0 from IOR (glass ~1.5 → ~0.04); metals use albedo.
  let ior = mix(m0Ior, m1Ior, mw);
  let f0d = pow((ior - 1.0) / (ior + 1.0), 2.0);
  let F0 = mix(vec3<f32>(f0d), baseColor, metalness);
  let F = fresnelSchlick(nDotV, F0);

  let kDir = normalize(keyDir);
  let fDir = normalize(fillDir);
  let rDir = normalize(rimDir);
  let hKey = normalize(kDir + v);
  let hFill = normalize(fDir + v);
  // Sharp glass highlights; still soften slightly with roughness.
  let specPow = mix(220.0, 24.0, roughness);
  let specKey = pow(max(dot(n, hKey), 0.0), specPow) * keyColor;
  let specFill = pow(max(dot(n, hFill), 0.0), specPow * 0.55) * fillColor * 0.35;
  let ndlKey = max(dot(n, kDir), 0.0);
  let ndlFill = max(dot(n, fDir), 0.0);
  let ndlRim = max(dot(n, rDir), 0.0);

  if (metalness > 0.7 && transmission < 0.2) {
    let diff = baseColor * (ambient + keyColor * ndlKey + fillColor * ndlFill);
    let lit = mix(diff, baseColor * (specKey * 1.4 + ambient * 0.25 + fillColor * ndlFill * 0.4), metalness);
    let outCol = tonemap(lit + F * (specKey + specFill) * (1.0 - roughness * 0.7) * specBoost);
    return vec4<f32>(outCol, hitT);
  }

  // Glass: strong Fresnel specular (not softened — that made plastic).
  let specAmt = (1.0 - roughness * 0.4) * mix(1.0, 1.35, transmission) * specBoost;
  let specular = F * (specKey * 1.85 + specFill) * specAmt;

  // Neon rim / edge glow — tight silhouette falloff so face centers stay tinted.
  let graze = clamp(1.0 - nDotV, 0.0, 1.0);
  let fresnelRim = pow(graze, 3.2);
  let edgeCore = pow(graze, 5.5);
  // Push rim toward cyan-white so blue glass edges read like the ref.
  let rimTint = mix(baseColor * 1.4, vec3<f32>(0.55, 0.92, 1.0), 0.45);
  let rim = rimTint * (fresnelRim * 1.6 + edgeCore * 2.8) * rimBoost;
  let rimLight = rimColor * fresnelRim * (0.45 + ndlRim * 0.7) * rimBoost * 0.55;

  // Dual-medium volume: adaptive steps + swirl density modulation.
  var T = vec3<f32>(1.0);
  var Cvol = vec3<f32>(0.0);
  var p = pos + rd * (surfaceEps * 2.0);
  let minDs = 0.8;
  let maxDs = 6.5;
  let maxPath = 150.0;
  var pathLen = 0.0;

  for (var vi = 0; vi < 24; vi++) {
    let s = sampleField(p);
    if (s.x > surfaceEps) {
      break;
    }

    let w = clamp(s.y, 0.0, 1.0);
    let col = mix(m0Color, m1Color, w);
    let sa = mix(m0SigmaA, m1SigmaA, w);
    let ss = mix(m0SigmaS, m1SigmaS, w);
    let localSwirl = mix(m0Swirl, m1Swirl, w);
    let dens = volumeSwirl(p, localSwirl);
    // Swirl modulates scatter more than absorption so clear glass stays clear.
    let saD = sa * mix(1.0, dens, 0.4);
    let ssD = ss * dens;
    let st = saD + ssD;
    let albedo = ssD / max(st, vec3<f32>(1e-4));

    let ds = clamp(max(-s.x, surfaceEps) * 0.5 + minDs * 0.3, minDs, maxDs);

    // Local thickness proxy from SDF (≈ distance to surface * 2) — free.
    let thickL = max(-s.x, 0.35) * 2.0;
    let lightAtt = exp(-saD * thickL);
    let Li = keyColor * lightAtt * 0.65 + fillColor * 0.4 + rimColor * 0.2;
    // Colored in-scatter; denser swirl bands read as molten filaments.
    let scatter = albedo * Li * col * (0.4 + 0.95 * dens);

    let Tr = exp(-st * ds);
    Cvol = Cvol + T * (vec3<f32>(1.0) - Tr) * scatter;
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

  // Beer-law body tint from actual path length (deep faces go darker blue/amber).
  let saHit = mix(m0SigmaA, m1SigmaA, mw);
  let beer = exp(-saHit * max(pathLen, 14.0));
  let faceFacing = pow(nDotV, 0.55);
  // Cyan (mw→0): deep sapphire slab. Amber (mw→1): molten volume dominates.
  let cyanBody = baseColor * vec3<f32>(0.55, 0.75, 1.2) * (
    0.28 + 0.55 * faceFacing + 0.45 * (1.0 - beer.y)
  );
  let amberBody = Cvol * 1.15 + baseColor * (1.0 - beer) * 0.55 * faceFacing;
  let slabBody = mix(cyanBody, amberBody, mw);
  let thru = T * (bg * mix(0.15, 0.35, mw) + baseColor * beer * mix(0.35, 0.55, mw));
  let body = slabBody + thru + Cvol * mix(0.35, 0.85, mw);
  let glass = (vec3<f32>(1.0) - F * 0.65) * body;
  // Tight edge sheen only (high power already on fresnelRim).
  let edgeSheen = rimTint * (edgeCore * 1.2 + fresnelRim * 0.35) * rimBoost;
  let lit = specular + glass + rim + rimLight + edgeSheen;

  return vec4<f32>(tonemap(lit), hitT);
}
`,
    // Shared helper FunctionNode (types: CodeNodeInclude[]).
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
  surfaceEps: f32
) -> f32 {
  let ro = cameraPos;
  let rd = normalize(worldPos - cameraPos);
  return sphereTrace(ro, rd, boundsMin, boundsMax, maxSteps, surfaceEps);
}
`,
    [fieldLib as never],
  );

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
    rimDir: uRimDir,
    rimColor: uRimColor,
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
    m0Rim: uM0Rim,
    m0Spec: uM0Spec,
    m0Swirl: uM0Swirl,
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
  };

  material.colorNode = Fn(() => {
    const shaded = shadeField(shadeArgs) as Node<"vec4">;
    If(shaded.w.lessThan(0.0), () => {
      Discard();
    });
    return shaded.xyz;
  })();

  material.depthNode = Fn(() => {
    const t = hitDepth({
      worldPos: positionWorld,
      cameraPos: cameraPosition,
      boundsMin: uBoundsMin,
      boundsMax: uBoundsMax,
      maxSteps: uMaxSteps,
      surfaceEps: uSurfaceEps,
    }) as Node<"float">;
    const rd = normalize(positionWorld.sub(cameraPosition));
    const hitPos = cameraPosition.add(rd.mul(t));
    const viewPos = cameraViewMatrix.mul(vec4(hitPos, 1.0));
    return viewZToPerspectiveDepth(viewPos.z, cameraNear, cameraFar);
  })();

  const mesh = new Mesh(geometry, material) as FieldRayMarchMesh;
  if (options.name) mesh.name = options.name;
  mesh.userData[RAY_MARCH_USER] = true;
  mesh.userData.fieldNode = fieldNode;
  if (options.definitionHash !== undefined) {
    mesh.userData.definitionHash = options.definitionHash;
  }
  mesh.userData.lookId = look.id;
  mesh.userData.rayMarchUniforms = {
    uAmbient,
    uKeyDir,
    uKeyColor,
    uFillDir,
    uFillColor,
    uRimDir,
    uRimColor,
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

/** Camera uniforms are TSL built-ins on WebGPU. */
export function updateRayMarchUniforms(
  _mesh: Mesh,
  _cameraPos: Vector3,
  _projectionMatrix: unknown,
  _viewMatrix: unknown,
): void {
  // no-op
}
