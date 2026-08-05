/**
 * Display materials for field solids (OpenPBR-inspired subset).
 * Units: sigma_* in 1/mm (world unit = 1 mm).
 *
 * Resins are tuned for interactive WebGPU: low extinction so dual-volume
 * paths stay cheap and the solids read as highly transparent.
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
  transmission: 0.97,
  ior: 1.49,
  // ~2× more transparent than first pass (half extinction).
  sigmaA: [0.025, 0.008, 0.004],
  sigmaS: [0.028, 0.04, 0.05],
};

/** Amber / orange resin — sphere in the demo (material weight 1). */
export const MAT_AMBER_RESIN: FieldMaterial = {
  id: "amber_resin",
  label: "Amber resin",
  baseColor: [0.92, 0.48, 0.12],
  roughness: 0.28,
  metalness: 0,
  transmission: 0.97,
  ior: 1.5,
  sigmaA: [0.005, 0.016, 0.036],
  sigmaS: [0.045, 0.036, 0.022],
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
