/**
 * SDF / implicit field solid types.
 *
 * Authority solid representation for three-cad (#14).
 * Meshes are derived only (export). Interactive display is field ray-march.
 *
 * Sign convention (mm):
 *   f < 0  inside
 *   f = 0  surface
 *   f > 0  outside
 *
 * Values are Euclidean distance for true-SDF primitives; CSG may yield
 * bound fields (safe lower bounds), not always true distance.
 */

export type Vec3 = readonly [number, number, number];

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Evaluable implicit solid. Pure data + evaluate — no mesh authority.
 * Measurement queries the field (project / integrate), not an op-tree.
 */
export interface FieldSolid {
  /** Signed field at a world point (mm). */
  evaluate(x: number, y: number, z: number): number;
  /** Conservative axis-aligned bounds in mm (may be padded by ops). */
  readonly bounds: Aabb;
  /**
   * Optional CSG leaf / material id for this node (primitives set this).
   * Boolean roots may also set a composite id; prefer {@link leafAt} for ownership.
   */
  readonly leafId?: string;
  /**
   * Which CSG leaf “owns” this point (materials / future feature identity).
   * Defaults to {@link leafId} when omitted (true for primitives).
   */
  leafAt?(x: number, y: number, z: number): string | undefined;
}

export interface MeshQuality {
  /**
   * Marching-cubes cell edge length in mm.
   * Smaller → sharper / denser mesh, more cost.
   */
  readonly cellSizeMm: number;
  /** Extra padding around bounds in mm (default: one cell). */
  readonly padMm?: number;
}

/** Triangle soup derived from a field (export only; not for interactive display). */
export interface DerivedMesh {
  /** Interleaved xyz positions (mm), length = 3 * vertexCount. */
  readonly positions: Float32Array;
  /** Triangle indices into positions/3. */
  readonly indices: Uint32Array;
}
