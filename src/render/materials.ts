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

/** Tinted AM-style resin — cube in the demo. */
export const MAT_TINTED_RESIN: FieldMaterial = {
  id: "tinted_resin",
  label: "Tinted resin",
  baseColor: [0.15, 0.55, 0.72],
  roughness: 0.25,
  metalness: 0,
  transmission: 0.92,
  ior: 1.49,
  // Prefer blue absorption → warm residual; light scatter for soft SSS.
  sigmaA: [0.045, 0.02, 0.012],
  sigmaS: [0.08, 0.1, 0.12],
};

/** Brushed-ish metal — sphere in the demo. */
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
 * 0 = resin (cube), 1 = metal (sphere). Smooth-union blends these continuously.
 */
export const DEMO_LEAF_MATERIAL_WEIGHT: Readonly<Record<string, number>> = {
  "demo-cube": 0,
  "demo-sphere": 1,
};
