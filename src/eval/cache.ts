/**
 * In-memory caches: definitionHash → FieldSolid, mesh key → DerivedMesh.
 */

import type { DerivedMesh, FieldSolid, MeshQuality } from "../sdf/types";
import { meshCacheKey } from "../document/hash";

export interface FieldCacheStats {
  readonly fieldHits: number;
  readonly fieldMisses: number;
  readonly meshHits: number;
  readonly meshMisses: number;
  readonly fieldEntries: number;
  readonly meshEntries: number;
}

export class FieldCache {
  private readonly fields = new Map<string, FieldSolid>();
  private fieldHits = 0;
  private fieldMisses = 0;

  get(hash: string): FieldSolid | undefined {
    const hit = this.fields.get(hash);
    if (hit) {
      this.fieldHits += 1;
      return hit;
    }
    this.fieldMisses += 1;
    return undefined;
  }

  set(hash: string, field: FieldSolid): void {
    this.fields.set(hash, field);
  }

  has(hash: string): boolean {
    return this.fields.has(hash);
  }

  clear(): void {
    this.fields.clear();
    this.fieldHits = 0;
    this.fieldMisses = 0;
  }

  get size(): number {
    return this.fields.size;
  }

  get hits(): number {
    return this.fieldHits;
  }

  get misses(): number {
    return this.fieldMisses;
  }
}

export class MeshCache {
  private readonly meshes = new Map<string, DerivedMesh>();
  private meshHits = 0;
  private meshMisses = 0;

  key(defHash: string, quality: MeshQuality): string {
    return meshCacheKey(defHash, quality);
  }

  get(defHash: string, quality: MeshQuality): DerivedMesh | undefined {
    const k = this.key(defHash, quality);
    const hit = this.meshes.get(k);
    if (hit) {
      this.meshHits += 1;
      return hit;
    }
    this.meshMisses += 1;
    return undefined;
  }

  set(defHash: string, quality: MeshQuality, mesh: DerivedMesh): void {
    this.meshes.set(this.key(defHash, quality), mesh);
  }

  clear(): void {
    this.meshes.clear();
    this.meshHits = 0;
    this.meshMisses = 0;
  }

  get size(): number {
    return this.meshes.size;
  }

  get hits(): number {
    return this.meshHits;
  }

  get misses(): number {
    return this.meshMisses;
  }
}
