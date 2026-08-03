/**
 * Selection model for viewport picks (field-native identity — #15).
 *
 * Selections are ephemeral UI context (not document state). Entity IDs are built
 * from the field solid graph (CSG leaf ids + crease topology on the derived
 * mesh), not from raw triangle indices. Meant for language/ops:
 * "distance between these two", "move this face 10 mm in +X".
 *
 * Display mesh is only an acceleration for hit-testing / highlights.
 */

import type { Vector3 } from "three";

export type SelectionKind = "solid" | "face" | "edge" | "vertex";

/** What the picker is allowed to return. */
export type SelectionFilter = "all" | SelectionKind;

export const SELECTION_FILTERS: readonly SelectionFilter[] = [
  "all",
  "solid",
  "face",
  "edge",
  "vertex",
] as const;

/** A single selected entity, identified for clipboard / future interpreter use. */
export interface SelectionRef {
  kind: SelectionKind;
  /** Full id, e.g. `face:demo-cube-sphere-union/f0` — clipboard token. */
  id: string;
  /** Solid the entity belongs to (same as id for kind solid). */
  solidId: string;
  /** Optional display name (solid mesh name). */
  label?: string;
  /** Geometry hints for future measure / edit (mm, world space). */
  geometry?: SelectionGeometry;
}

export type SelectionGeometry =
  | { kind: "solid"; centroid: Vector3 }
  | { kind: "face"; centroid: Vector3; normal: Vector3 }
  | { kind: "edge"; a: Vector3; b: Vector3 }
  | { kind: "vertex"; position: Vector3 };

export function selectionFilterLabel(filter: SelectionFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "solid":
      return "Solid";
    case "face":
      return "Face";
    case "edge":
      return "Edge";
    case "vertex":
      return "Vertex";
  }
}

export function nextSelectionFilter(current: SelectionFilter): SelectionFilter {
  const i = SELECTION_FILTERS.indexOf(current);
  return SELECTION_FILTERS[(i + 1) % SELECTION_FILTERS.length]!;
}

/** Format selection for clipboard (one id per line; empty string if none). */
export function formatSelectionClipboard(refs: readonly SelectionRef[]): string {
  if (refs.length === 0) return "";
  return refs.map((r) => r.id).join("\n");
}

export function makeSolidId(meshName: string, index: number): string {
  const base = meshName.trim() || `solid-${index}`;
  // Keep clipboard-friendly: no spaces.
  return base.replace(/\s+/g, "-");
}

export function makeEntityId(
  kind: Exclude<SelectionKind, "solid">,
  solidId: string,
  local: string,
): string {
  return `${kind}:${solidId}/${local}`;
}

export function makeSolidEntityId(solidId: string): string {
  return `solid:${solidId}`;
}
