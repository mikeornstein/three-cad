/**
 * Minimal assembly document types (schema stub for #17).
 * Full schema and ops land with later tickets; this is enough to bind
 * part definitions to the field evaluator.
 */

import type { FieldGeneratorRef, PartFieldPayload } from "./fieldDef";

export type PartId = string;
export type InstanceId = string;

export type PartKind =
  | "generic"
  | "machined"
  | "sheet"
  | "molded"
  | "am"
  | "imported";

/**
 * Reusable geometric definition. Not yet placed in space.
 * For generic field parts, payload is a serializable FieldNode tree.
 */
export interface PartDef {
  readonly id: PartId;
  readonly kind: PartKind;
  readonly generator: FieldGeneratorRef;
  readonly payload: PartFieldPayload;
  readonly attributes?: {
    readonly name?: string;
    readonly notes?: string;
  };
}

/** Place a part in the assembly (transform applied outside the part field cache). */
export interface InstanceDef {
  readonly id: InstanceId;
  readonly part: PartId;
  /** Translation in mm (world). Rotation later. */
  readonly translation?: readonly [number, number, number];
  readonly visible?: boolean;
}

/**
 * In-memory assembly document. Not yet load/save — structured enough for
 * evaluate → viewport wiring.
 */
export interface AssemblyDocument {
  readonly schemaVersion: number;
  readonly units: "mm";
  readonly meta?: { readonly name?: string };
  readonly parts: ReadonlyMap<PartId, PartDef>;
  readonly instances: readonly InstanceDef[];
}

export const DOCUMENT_SCHEMA_VERSION = 1 as const;
