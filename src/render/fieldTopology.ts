/**
 * Lightweight field-only topology for ray-marched solids (no triangle authority).
 *
 * Faces are CSG leaves from the FieldNode tree. Edges/vertices empty until
 * crease extraction is field-native without a display mesh.
 */

import { Mesh, Vector3 } from "three";
import type { FieldNode } from "../document/fieldDef";
import type { FieldSolid } from "../sdf";
import {
  makeEntityId,
  makeSolidEntityId,
  makeSolidId,
  type SelectionKind,
} from "../selection/types";
import type {
  SolidTopology,
  TopologyFace,
  TopologyIndex,
} from "../selection/topology";
import { isRayMarchMesh } from "./createFieldRayMarchMesh";

/**
 * Build a TopologyIndex for ray-march meshes (field authority, leaf faces).
 * Mesh triangle topology is intentionally empty.
 */
export function buildRayMarchTopologyIndex(
  meshes: readonly Mesh[],
): TopologyIndex {
  const solids: SolidTopology[] = [];
  const byEntityId = new Map<
    string,
    { solid: SolidTopology; kind: SelectionKind; localIndex: number }
  >();

  meshes.forEach((mesh, meshIndex) => {
    if (!isRayMarchMesh(mesh)) return;
    const field = mesh.userData.fieldSolid as FieldSolid | undefined;
    const fieldNode = mesh.userData.fieldNode as FieldNode | undefined;
    if (!field) return;

    const solidId = makeSolidId(mesh.name || "field", meshIndex);
    const solidEntityId = makeSolidEntityId(solidId);
    const leafIds = fieldNode
      ? collectLeafIds(fieldNode)
      : field.leafId
        ? [field.leafId]
        : [];

    const center = new Vector3(
      (field.bounds.min[0] + field.bounds.max[0]) * 0.5,
      (field.bounds.min[1] + field.bounds.max[1]) * 0.5,
      (field.bounds.min[2] + field.bounds.max[2]) * 0.5,
    );

    const faces: TopologyFace[] = leafIds.map((leafId) => {
      const localId = `leaf-${leafId}`;
      return {
        localId,
        id: makeEntityId("face", solidId, localId),
        leafId,
        triangleIndices: [],
        centroid: center.clone(),
        normal: new Vector3(0, 0, 1),
      };
    });

    // If no leaves, one synthetic face for the solid body
    if (faces.length === 0) {
      faces.push({
        localId: "f0",
        id: makeEntityId("face", solidId, "f0"),
        leafId: field.leafId,
        triangleIndices: [],
        centroid: center.clone(),
        normal: new Vector3(0, 0, 1),
      });
    }

    const solid: SolidTopology = {
      solidId,
      solidEntityId,
      mesh,
      field,
      faces,
      edges: [],
      vertices: [],
      triToFace: new Int32Array(0),
      triLeaf: [],
      edgePositions: new Float32Array(0),
      segmentToEdge: new Int32Array(0),
      vertexPositions: new Float32Array(0),
      edgeByIndex: [],
      vertexByIndex: [],
    };

    solids.push(solid);
    byEntityId.set(solidEntityId, {
      solid,
      kind: "solid",
      localIndex: 0,
    });
    faces.forEach((f, i) => {
      byEntityId.set(f.id, { solid, kind: "face", localIndex: i });
    });
  });

  return { solids, byEntityId };
}

/** Collect unique leafId strings from a FieldNode tree (pre-order). */
export function collectLeafIds(node: FieldNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (n: FieldNode): void => {
    if ("leafId" in n && n.leafId && !seen.has(n.leafId)) {
      seen.add(n.leafId);
      out.push(n.leafId);
    }
    switch (n.op) {
      case "union":
      case "intersection":
      case "difference":
      case "smoothUnion":
        walk(n.a);
        walk(n.b);
        break;
      case "translate":
      case "offset":
        walk(n.solid);
        break;
      default:
        break;
    }
  };
  walk(node);
  return out;
}
