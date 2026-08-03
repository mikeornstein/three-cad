/**
 * Field evaluator: PartDef → FieldSolid + derived mesh, cached by content hash.
 *
 * Document intent is authority. Fields and meshes are derived artifacts.
 * Evaluation is pure given a PartDef (worker-friendly: same path hydrates FieldNode).
 */

import { definitionHash } from "../document/hash";
import type { PartDef } from "../document/types";
import {
  fieldToMesh,
  type DerivedMesh,
  type FieldSolid,
  type MeshQuality,
} from "../sdf";
import { buildField } from "./buildField";
import { FieldCache, MeshCache, type FieldCacheStats } from "./cache";

export interface EvaluatedPart {
  readonly definitionHash: string;
  readonly field: FieldSolid;
  readonly mesh: DerivedMesh;
  readonly quality: MeshQuality;
  /** True when both field and mesh came from cache. */
  readonly cacheHit: {
    readonly field: boolean;
    readonly mesh: boolean;
  };
}

export interface EvaluatedFieldOnly {
  readonly definitionHash: string;
  readonly field: FieldSolid;
  readonly fieldCacheHit: boolean;
}

export class FieldEvaluator {
  readonly fields = new FieldCache();
  readonly meshes = new MeshCache();

  /** Hash + hydrate field (cached). Does not tessellate. */
  getField(part: PartDef): EvaluatedFieldOnly {
    const hash = hashPart(part);
    const cached = this.fields.get(hash);
    if (cached) {
      return { definitionHash: hash, field: cached, fieldCacheHit: true };
    }
    // miss already counted by get; rebuild and store
    const field = buildField(part.payload.field);
    this.fields.set(hash, field);
    return { definitionHash: hash, field, fieldCacheHit: false };
  }

  /**
   * Field + display/export mesh. Mesh key includes quality.
   * Unchanged parts with the same quality do not rebuild.
   */
  evaluatePart(part: PartDef, quality: MeshQuality): EvaluatedPart {
    const { definitionHash: hash, field, fieldCacheHit } = this.getField(part);

    const meshCached = this.meshes.get(hash, quality);
    if (meshCached) {
      return {
        definitionHash: hash,
        field,
        mesh: meshCached,
        quality,
        cacheHit: { field: fieldCacheHit, mesh: true },
      };
    }

    const mesh = fieldToMesh(field, quality);
    this.meshes.set(hash, quality, mesh);
    return {
      definitionHash: hash,
      field,
      mesh,
      quality,
      cacheHit: { field: fieldCacheHit, mesh: false },
    };
  }

  clear(): void {
    this.fields.clear();
    this.meshes.clear();
  }

  stats(): FieldCacheStats {
    return {
      fieldHits: this.fields.hits,
      fieldMisses: this.fields.misses,
      meshHits: this.meshes.hits,
      meshMisses: this.meshes.misses,
      fieldEntries: this.fields.size,
      meshEntries: this.meshes.size,
    };
  }
}

/** Content hash for a part definition (geometry identity). */
export function hashPart(part: PartDef): string {
  return definitionHash({
    kind: part.kind,
    generator: part.generator,
    payload: part.payload,
  });
}

/** Default shared evaluator for the host (main thread). */
let defaultEvaluator: FieldEvaluator | undefined;

export function getDefaultEvaluator(): FieldEvaluator {
  if (!defaultEvaluator) defaultEvaluator = new FieldEvaluator();
  return defaultEvaluator;
}

export function resetDefaultEvaluator(): void {
  defaultEvaluator?.clear();
  defaultEvaluator = undefined;
}
