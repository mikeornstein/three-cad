/**
 * SDF / implicit field solid kernel (plan of record — #14).
 *
 * Document intent is authority. FieldSolid is the solid representation.
 * Meshes from fieldToMesh are display/export derivatives only.
 */

export type {
  Aabb,
  DerivedMesh,
  FieldSolid,
  MeshQuality,
  Vec3,
} from "./types";

export { aabb, aabbSize, padAabb, translateAabb, unionAabb } from "./bounds";
export {
  boxSolid,
  cylinderSolid,
  sphereSolid,
} from "./primitives";
export type { CylinderAxis } from "./primitives";
export {
  difference,
  intersection,
  offset,
  smoothUnion,
  translate,
  union,
} from "./ops";
export { fieldToMesh } from "./mesh/marchingCubes";
export { fieldGradient, fieldNormal, leafAt } from "./leaf";
