/**
 * SDF / implicit field solid kernel (plan of record — #14).
 *
 * Document intent is authority. FieldSolid is the solid representation.
 * Meshes from fieldToMesh are display/export derivatives only.
 * Measurement queries the field (see fieldMeasure), not an op-tree.
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
  FIELD_LINEAR_TOL_MM,
  MICRON_MM,
  measureEdgeOnField,
  measurePlanarFaceFromField,
  nearlyEqual,
  nearlyEqualVec,
  projectPointOnField,
  projectToCrease,
  projectToSurface,
  type EdgeMeasure,
  type PlanarFaceMeasure,
} from "./fieldMeasure";
export {
  axisFaceBin,
  edgeness,
  EDGENESS_MIN,
  featureScore,
  FEATURE_MIN,
  pairDihedral,
  planeBasis,
} from "./fieldFeatures";
export {
  densifyRegionForHighlight,
  growSurfaceRegion,
  type GrowSurfaceRegionOpts,
  type SurfaceRegion,
} from "./fieldRegion";
