/**
 * Display materials for field solids (OpenPBR-inspired subset).
 * Units: sigma_* in 1/mm (world unit = 1 mm).
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
}

/** Cyan AM-style resin — cube in the demo (material weight 0). */
export const MAT_CYAN_RESIN: FieldMaterial = {
  id: "cyan_resin",
  label: "Cyan resin",
  baseColor: [0.12, 0.62, 0.78],
  roughness: 0.22,
  metalness: 0,
  transmission: 0.94,
  ior: 1.49,
  // Absorb red/green more → cyan residual; moderate scatter for soft SSS.
  sigmaA: [0.055, 0.018, 0.01],
  sigmaS: [0.06, 0.09, 0.11],
};

/** Amber / orange resin — sphere in the demo (material weight 1). */
export const MAT_AMBER_RESIN: FieldMaterial = {
  id: "amber_resin",
  label: "Amber resin",
  baseColor: [0.92, 0.48, 0.12],
  roughness: 0.28,
  metalness: 0,
  transmission: 0.94,
  ior: 1.5,
  // Absorb blue → warm amber residual.
  sigmaA: [0.012, 0.035, 0.08],
  sigmaS: [0.1, 0.08, 0.05],
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
