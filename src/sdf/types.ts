/**
 * SDF / implicit field solid types.
 *
 * Authority solid representation for three-cad (#14).
 * Meshes are derived only (display / export / temporary picking).
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
 */
export interface FieldSolid {
  /** Signed field at a world point (mm). */
  evaluate(x: number, y: number, z: number): number;
  /** Conservative axis-aligned bounds in mm (may be padded by ops). */
  readonly bounds: Aabb;
  /**
   * Optional CSG leaf / material id for this node (primitives set this).
   * Boolean roots may also set a composite id; prefer {@link leafAt} for selection.
   */
  readonly leafId?: string;
  /**
   * Which CSG leaf “owns” this point (for region selection on the surface).
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

/** Triangle soup derived from a field (display / export only). */
export interface DerivedMesh {
  /** Interleaved xyz positions (mm), length = 3 * vertexCount. */
  readonly positions: Float32Array;
  /** Triangle indices into positions/3. */
  readonly indices: Uint32Array;
}
