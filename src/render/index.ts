/**
 * Mesh-free field display: FieldNode → WGSL → WebGPU sphere trace.
 * Triangle meshes remain export-only (see src/sdf/mesh).
 */

export { boundsOf, orderedMax, orderedMin } from "./fieldBounds";
export {
  fieldNodeToWgsl,
  WGSL_SDF_HELPERS,
  type FieldWgslCompileOptions,
  type FieldWgslCompileResult,
} from "./fieldToWgsl";
export {
  DEMO_LEAF_MATERIAL_WEIGHT,
  MAT_AMBER_RESIN,
  MAT_CYAN_RESIN,
  MAT_MACHINED_METAL,
  MAT_TINTED_RESIN,
  type FieldMaterial,
} from "./materials";
export {
  createFieldRayMarchMesh,
  isRayMarchMesh,
  RAY_MARCH_USER,
  updateRayMarchUniforms,
  type FieldRayMarchMesh,
  type FieldRayMarchOptions,
} from "./createFieldRayMarchMesh";
