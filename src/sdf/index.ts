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
export {
  exactFeatures,
  MICRON_MM,
  nearlyEqual,
  nearlyEqualVec,
  type ExactEdge,
  type ExactFeatureSet,
  type ExactVertex,
} from "./exactFeatures";
export {
  FIELD_LINEAR_TOL_MM,
  measurePlanarFaceFromField,
  projectToSurface,
  type PlanarFaceMeasure,
} from "./fieldMeasure";
