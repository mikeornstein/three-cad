/**
 * Mesh-free field display: FieldNode → GLSL → sphere trace.
 * Triangle meshes remain export-only (see src/sdf/mesh).
 */

export {
  boundsOf,
  fieldNodeToGlsl,
  GLSL_SDF_HELPERS,
  type FieldGlslCompileResult,
} from "./fieldToGlsl";
export {
  createFieldRayMarchMesh,
  isRayMarchMesh,
  RAY_MARCH_USER,
  setRayMarchDisplayMode,
  updateRayMarchUniforms,
  type FieldRayMarchMesh,
  type FieldRayMarchOptions,
} from "./createFieldRayMarchMesh";
export {
  pickFieldAtPointer,
  sphereTraceAlongRay,
  sphereTraceField,
  type FieldPickTarget,
  type FieldRayHit,
} from "./fieldRayPick";
export {
  buildRayMarchTopologyIndex,
  collectLeafIds,
} from "./fieldTopology";
