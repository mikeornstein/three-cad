/**
 * Scene look presets: background, lights, grid — independent of solid materials.
 * Pair with FieldMaterial slots via the materials library (refs/).
 *
 * Studio product looks expect a real HDRI (see studioEnv.ts). Directional
 * key/fill here are fallbacks; when HDRI is loaded, Viewport replaces them
 * with probes extracted from the map and the field shader samples the HDR.
 */

export interface SceneLook {
  readonly id: string;
  readonly label: string;
  /** Three.js clear / fallback background (hex) when HDRI is not yet bound. */
  readonly background: number;
  /** Ambient floor in the field shader (linear RGB). Keep low for studio. */
  readonly ambient: readonly [number, number, number];
  /** Fallback key (used until HDRI probes replace them). */
  readonly keyDir: readonly [number, number, number];
  readonly keyColor: readonly [number, number, number];
  readonly fillDir: readonly [number, number, number];
  readonly fillColor: readonly [number, number, number];
  readonly rimDir: readonly [number, number, number];
  readonly rimColor: readonly [number, number, number];
  /** Grid helper colors. */
  readonly gridCenter: number;
  readonly gridLine: number;
  /** Cap device pixel ratio for field shading cost while interacting. */
  readonly maxPixelRatio: number;
  /**
   * Pixel-ratio cap after the viewport settles (camera idle).
   * Higher than maxPixelRatio sharpens edges when orbit cost is free.
   */
  readonly stillMaxPixelRatio: number;
  /** Default sphere-trace step budget. */
  readonly maxSteps: number;
  /** Surface hit epsilon (mm). */
  readonly surfaceEpsMm: number;
  /** Multiplier on HDR equirect samples in the field shader. */
  readonly envIntensity: number;
  /** Background exposure of the HDRI (scene sky). Low = dark product void. */
  readonly backgroundIntensity: number;
  /** Blur HDRI background (0–1). */
  readonly backgroundBlurriness: number;
}

/**
 * Photo studio — refs/mat_ref_01.jpg look-dev.
 * IBL: public/env/studio_small_08_1k.hdr (Poly Haven CC0 softbox studio).
 * Background dimmed + blurred so the cove does not compete with the model.
 */
export const LOOK_MAT_REF_01: SceneLook = {
  id: "mat_ref_01",
  label: "Mat ref 01 — photo studio HDRI",
  background: 0x05060a,
  ambient: [0.008, 0.01, 0.012],
  // Fallback only — replaced by HDR probes when env loads.
  keyDir: [0.55, -0.65, 0.85],
  keyColor: [0.9, 0.88, 0.85],
  fillDir: [-0.7, 0.4, 0.35],
  fillColor: [0.15, 0.22, 0.35],
  rimDir: [-0.35, 0.85, 0.2],
  rimColor: [0.12, 0.18, 0.28],
  gridCenter: 0x5a6570,
  gridLine: 0x1e242c,
  // Cap ≤1 so retina fill-rate does not melt the glass volume path when framed.
  maxPixelRatio: 1,
  // Settled view may spend fill-rate for sharper edges (retina / high-DPI).
  stillMaxPixelRatio: 2,
  maxSteps: 80,
  surfaceEpsMm: 0.06,
  envIntensity: 1.0,
  // Near-black void; IBL on the solid stays full-strength.
  backgroundIntensity: 0.035,
  backgroundBlurriness: 0.92,
};

/** Neutral mechanical inspection look. */
export const LOOK_INSPECT: SceneLook = {
  id: "inspect",
  label: "Inspect — neutral mechanical",
  background: 0x1a1c1e,
  ambient: [0.25, 0.25, 0.25],
  keyDir: [200, -120, 280],
  keyColor: [1.0, 1.0, 1.0],
  fillDir: [-180, 100, 80],
  fillColor: [0.2, 0.25, 0.32],
  rimDir: [0, 1, 0.2],
  rimColor: [0.12, 0.14, 0.16],
  gridCenter: 0x5a6570,
  gridLine: 0x2e343a,
  maxPixelRatio: 1,
  stillMaxPixelRatio: 1.5,
  maxSteps: 64,
  surfaceEpsMm: 0.08,
  envIntensity: 0.8,
  backgroundIntensity: 0.5,
  backgroundBlurriness: 0.1,
};

/** Product default: glass studio (mat_ref_01). */
export const DEFAULT_LOOK: SceneLook = LOOK_MAT_REF_01;

/**
 * Lower sphere-trace budget for coarse-pointer / phone clients.
 * Keeps material look; only quality knobs change.
 */
export function withMobileCaps(look: SceneLook): SceneLook {
  return {
    ...look,
    maxPixelRatio: Math.min(look.maxPixelRatio, 1),
    stillMaxPixelRatio: Math.min(look.stillMaxPixelRatio, 1),
    maxSteps: Math.min(look.maxSteps, 48),
    surfaceEpsMm: Math.max(look.surfaceEpsMm, 0.08),
  };
}
