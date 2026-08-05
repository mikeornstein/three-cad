/**
 * Materials + scene look library keyed to reference images under refs/.
 *
 * Workflow (see refs/README.md):
 * 1. Drop a reference still under refs/
 * 2. Capture a baseline screenshot (scripts/lookdev-capture.mjs)
 * 3. Derive FieldMaterial slots + SceneLook; register here
 * 4. Capture after shot; iterate until close
 * 5. Document notes next to the ref
 */

import {
  MAT_AMBER_RESIN,
  MAT_CYAN_RESIN,
  MAT_MACHINED_METAL,
  type FieldMaterial,
} from "./materials";
import {
  DEFAULT_LOOK,
  LOOK_INSPECT,
  LOOK_MAT_REF_01,
  type SceneLook,
} from "./looks";

export interface MaterialLookEntry {
  readonly id: string;
  /** Path relative to repo root. */
  readonly refImage: string;
  readonly label: string;
  readonly notes: string;
  /** Material weight 0 (demo cube). */
  readonly material0: FieldMaterial;
  /** Material weight 1 (demo sphere). */
  readonly material1: FieldMaterial;
  readonly look: SceneLook;
}

/** Catalog of look-dev entries. Grow this as refs/ fills out. */
export const MATERIAL_LIBRARY: readonly MaterialLookEntry[] = [
  {
    id: "mat_ref_01",
    refImage: "refs/mat_ref_01.jpg",
    label: "Cyan glass cube + amber glass sphere",
    notes:
      "Dark studio, neon Fresnel edges on blue glass, molten amber volume swirl, bright specular hotspots. Geometry in the ref is illustrative only.",
    material0: MAT_CYAN_RESIN,
    material1: MAT_AMBER_RESIN,
    look: LOOK_MAT_REF_01,
  },
];

/** Default product demo entry (first library match or mat_ref_01). */
export const DEFAULT_LIBRARY_ENTRY: MaterialLookEntry =
  MATERIAL_LIBRARY[0] ?? {
    id: "fallback",
    refImage: "",
    label: "Fallback inspect",
    notes: "",
    material0: MAT_CYAN_RESIN,
    material1: MAT_AMBER_RESIN,
    look: DEFAULT_LOOK,
  };

export function getLibraryEntry(id: string): MaterialLookEntry | undefined {
  return MATERIAL_LIBRARY.find((e) => e.id === id);
}

export {
  DEFAULT_LOOK,
  LOOK_INSPECT,
  LOOK_MAT_REF_01,
  MAT_AMBER_RESIN,
  MAT_CYAN_RESIN,
  MAT_MACHINED_METAL,
  type FieldMaterial,
  type SceneLook,
};
