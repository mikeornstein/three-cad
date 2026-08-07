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
  type LiveFieldParam,
} from "./fieldToWgsl";
export {
  DEMO_LEAF_MATERIAL_WEIGHT,
  MAT_AMBER_RESIN,
  MAT_CYAN_RESIN,
  MAT_MACHINED_METAL,
  MAT_TINTED_RESIN,
  materialRimBoost,
  materialSpeckDensity,
  materialSpecularBoost,
  materialSwirl,
  type FieldMaterial,
} from "./materials";
export {
  DEFAULT_LOOK,
  LOOK_INSPECT,
  LOOK_MAT_REF_01,
  type SceneLook,
} from "./looks";
export {
  DEFAULT_LIBRARY_ENTRY,
  getLibraryEntry,
  MATERIAL_LIBRARY,
  type MaterialLookEntry,
} from "./library";
export {
  DEFAULT_HDR_ID,
  loadStudioEnvironment,
  zUpDirectionToYUp,
  type StudioEnvironment,
} from "./studioEnv";
export {
  applyRayMarchQuality,
  createFieldRayMarchMesh,
  isRayMarchMesh,
  LIVE_SPHERE_USER,
  RAY_MARCH_USER,
  updateRayMarchUniforms,
  type FieldRayMarchMesh,
  type FieldRayMarchOptions,
  type LiveSphereHandle,
  type LiveSphereSpec,
  type RayMarchUniformBag,
} from "./createFieldRayMarchMesh";
