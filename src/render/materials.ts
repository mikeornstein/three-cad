/**
 * Display materials for field solids (OpenPBR-inspired subset).
 * Units: sigma_* in 1/mm (world unit = 1 mm).
 *
 * Presets are tuned against refs/ look-dev images (see materials library).
 * Interactive WebGPU target: rich glass/resin read without nested light rays.
 */

export interface FieldMaterial {
  readonly id: string;
  readonly label: string;
  /** Linear RGB base / albedo. */
  readonly baseColor: readonly [number, number, number];
  readonly roughness: number;
  readonly metalness: number;
  /** 0 = opaque shell, 1 = fully transmitting medium. */
  readonly transmission: number;
  readonly ior: number;
  /** Absorption coefficient (1/mm), RGB. */
  readonly sigmaA: readonly [number, number, number];
  /** Scattering coefficient (1/mm), RGB — drives cheap single-scatter SSS. */
  readonly sigmaS: readonly [number, number, number];
  /**
   * Fresnel rim / edge glow strength (glass neon edges).
   * Default 1 when omitted.
   */
  readonly rimBoost?: number;
  /**
   * Specular highlight gain. Glass wants >1; soft plastic <1.
   * Default 1 when omitted.
   */
  readonly specularBoost?: number;
  /**
   * Procedural volume swirl amount in [0, 1] (density variation).
   * Default 0 when omitted.
   */
  readonly swirl?: number;
}

/** Resolve optional display gains with defaults. */
export function materialRimBoost(m: FieldMaterial): number {
  return m.rimBoost ?? 1;
}

export function materialSpecularBoost(m: FieldMaterial): number {
  return m.specularBoost ?? 1;
}

export function materialSwirl(m: FieldMaterial): number {
  return m.swirl ?? 0;
}

/**
 * Cyan glass-resin — cube slot (mat weight 0).
 * Tuned toward refs/mat_ref_01.jpg: deep blue interior, neon Fresnel edges.
 * Low extinction so a 100 mm slab still reads as see-through glass.
 */
export const MAT_CYAN_RESIN: FieldMaterial = {
  id: "cyan_resin",
  label: "Cyan resin",
  // Deep electric blue (linear); edges push toward cyan-white via rim.
  baseColor: [0.02, 0.22, 0.95],
  roughness: 0.04,
  metalness: 0,
  transmission: 0.99,
  ior: 1.52,
  // Stronger R/G absorb → deep blue body; B nearly free for glow.
  sigmaA: [0.04, 0.016, 0.002],
  sigmaS: [0.012, 0.025, 0.045],
  rimBoost: 4.0,
  specularBoost: 2.5,
  swirl: 0.06,
};

/**
 * Amber glass-resin — sphere slot (mat weight 1).
 * Tuned toward refs/mat_ref_01.jpg: molten amber volume, bright specular.
 */
export const MAT_AMBER_RESIN: FieldMaterial = {
  id: "amber_resin",
  label: "Amber resin",
  baseColor: [1.0, 0.28, 0.015],
  roughness: 0.05,
  metalness: 0,
  transmission: 0.98,
  ior: 1.52,
  // Warm absorption + scatter so swirl filaments read as molten amber.
  sigmaA: [0.003, 0.025, 0.07],
  sigmaS: [0.08, 0.05, 0.02],
  rimBoost: 1.4,
  specularBoost: 2.5,
  swirl: 1.0,
};

/** @deprecated Alias — prefer MAT_CYAN_RESIN. */
export const MAT_TINTED_RESIN = MAT_CYAN_RESIN;

/** Brushed-ish metal — optional opaque leaf. */
export const MAT_MACHINED_METAL: FieldMaterial = {
  id: "machined_metal",
  label: "Machined metal",
  baseColor: [0.72, 0.74, 0.78],
  roughness: 0.35,
  metalness: 1,
  transmission: 0,
  ior: 1.45,
  sigmaA: [8, 8, 8],
  sigmaS: [0, 0, 0],
  rimBoost: 0.4,
  specularBoost: 1.2,
  swirl: 0,
};

/**
 * Leaf id → material-blend weight for the demo tree.
 * 0 = cyan resin (cube), 1 = amber resin (sphere).
 * Smooth-union blends these continuously for a clean color gradient.
 */
export const DEMO_LEAF_MATERIAL_WEIGHT: Readonly<Record<string, number>> = {
  "demo-cube": 0,
  "demo-sphere": 1,
};
