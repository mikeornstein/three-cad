/**
 * Display materials for field solids (OpenPBR-inspired subset).
 * Units: sigma_* in 1/mm (world unit = 1 mm).
 *
 * Clear resins with optional volume specks (particulate flecks).
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
  /** Scattering coefficient (1/mm), RGB — keep low for clear glass. */
  readonly sigmaS: readonly [number, number, number];
  /** Fresnel rim strength (glass edge). Default 1. */
  readonly rimBoost?: number;
  /** Specular / env reflection gain. Default 1. */
  readonly specularBoost?: number;
  /** Procedural volume swirl amount in [0, 1]. Default 0. */
  readonly swirl?: number;
  /**
   * Fine material flecks suspended through the volume [0, 1].
   * Even bulk distribution; not surface dirt. Default 0.
   */
  readonly speckDensity?: number;
}

export function materialRimBoost(m: FieldMaterial): number {
  return m.rimBoost ?? 1;
}

export function materialSpecularBoost(m: FieldMaterial): number {
  return m.specularBoost ?? 1;
}

export function materialSwirl(m: FieldMaterial): number {
  return m.swirl ?? 0;
}

export function materialSpeckDensity(m: FieldMaterial): number {
  return m.speckDensity ?? 0;
}

/**
 * Cyan glass-resin — cube (mat weight 0).
 * Super clear sapphire with fine volume specks.
 */
export const MAT_CYAN_RESIN: FieldMaterial = {
  id: "cyan_resin",
  label: "Cyan resin",
  baseColor: [0.04, 0.28, 0.95],
  roughness: 0.06,
  metalness: 0,
  transmission: 0.97,
  ior: 1.52,
  sigmaA: [0.01, 0.004, 0.0012],
  sigmaS: [0.004, 0.008, 0.014],
  rimBoost: 1.4,
  specularBoost: 0.75,
  swirl: 0.04,
  // Fine flecks through the bulk (clear glass with inclusions).
  speckDensity: 0.45,
};

/**
 * Amber glass-resin — sphere (mat weight 1).
 * Clear molten amber with fine interior flecks for depth.
 */
export const MAT_AMBER_RESIN: FieldMaterial = {
  id: "amber_resin",
  label: "Amber resin",
  baseColor: [0.98, 0.32, 0.03],
  roughness: 0.07,
  metalness: 0,
  transmission: 0.96,
  ior: 1.52,
  sigmaA: [0.0025, 0.012, 0.036],
  sigmaS: [0.012, 0.01, 0.006],
  rimBoost: 1.0,
  specularBoost: 0.7,
  swirl: 0.55,
  speckDensity: 0.55,
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
  specularBoost: 1.0,
  swirl: 0,
  speckDensity: 0,
};

export const DEMO_LEAF_MATERIAL_WEIGHT: Readonly<Record<string, number>> = {
  "demo-cube": 0,
  "demo-sphere": 1,
};
