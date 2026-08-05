/**
 * Scene look presets: background, lights, grid — independent of solid materials.
 * Pair with FieldMaterial slots via the materials library (refs/).
 */

export interface SceneLook {
  readonly id: string;
  readonly label: string;
  /** Three.js scene / clear color (hex). */
  readonly background: number;
  /** Ambient contribution in the field shader (linear RGB * intensity). */
  readonly ambient: readonly [number, number, number];
  /** Key light direction (world, unnormalized ok) + color*intensity. */
  readonly keyDir: readonly [number, number, number];
  readonly keyColor: readonly [number, number, number];
  /** Fill light direction + color*intensity. */
  readonly fillDir: readonly [number, number, number];
  readonly fillColor: readonly [number, number, number];
  /** Soft rim / kicker for glass edges (optional third light). */
  readonly rimDir: readonly [number, number, number];
  readonly rimColor: readonly [number, number, number];
  /** Grid helper colors. */
  readonly gridCenter: number;
  readonly gridLine: number;
  /** Cap device pixel ratio for field shading cost. */
  readonly maxPixelRatio: number;
  /** Default sphere-trace step budget. */
  readonly maxSteps: number;
  /** Surface hit epsilon (mm). */
  readonly surfaceEpsMm: number;
}

/**
 * Dark studio look matched to refs/mat_ref_01.jpg.
 * Near-black void, cool key, subtle warm fill, bright grid.
 */
export const LOOK_MAT_REF_01: SceneLook = {
  id: "mat_ref_01",
  label: "Mat ref 01 — dark glass studio",
  background: 0x03050a,
  ambient: [0.06, 0.08, 0.12],
  keyDir: [0.55, -0.65, 0.9],
  keyColor: [1.55, 1.5, 1.42],
  fillDir: [-0.75, 0.45, 0.35],
  fillColor: [0.18, 0.3, 0.58],
  rimDir: [-0.4, 0.9, 0.2],
  rimColor: [0.4, 0.65, 1.15],
  gridCenter: 0x7a8696,
  gridLine: 0x222830,
  maxPixelRatio: 1.5,
  maxSteps: 80,
  surfaceEpsMm: 0.06,
};

/** Neutral mechanical inspection look (pre-lookdev default). */
export const LOOK_INSPECT: SceneLook = {
  id: "inspect",
  label: "Inspect — neutral mechanical",
  background: 0x1a1c1e,
  ambient: [0.32, 0.32, 0.32],
  keyDir: [200, -120, 280],
  keyColor: [1.1, 1.1, 1.1],
  fillDir: [-180, 100, 80],
  fillColor: [0.22, 0.28, 0.35],
  rimDir: [0, 1, 0.2],
  rimColor: [0.15, 0.18, 0.22],
  gridCenter: 0x5a6570,
  gridLine: 0x2e343a,
  maxPixelRatio: 1,
  maxSteps: 64,
  surfaceEpsMm: 0.08,
};

/** Product default: glass studio (mat_ref_01). */
export const DEFAULT_LOOK: SceneLook = LOOK_MAT_REF_01;
