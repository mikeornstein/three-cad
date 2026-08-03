/**
 * Web Worker: hydrate FieldNode → mesh (transferable buffers).
 * Main thread keeps FieldSolid via the same PartDef path (closures are not transferable).
 */

import type { FieldNode } from "../../document/fieldDef";
import type { MeshQuality } from "../../sdf/types";
import { fieldToMesh } from "../../sdf/mesh/marchingCubes";
import { buildField } from "../buildField";

export interface MeshWorkerRequest {
  readonly type: "mesh";
  readonly id: number;
  readonly field: FieldNode;
  readonly quality: MeshQuality;
}

export interface MeshWorkerResponse {
  readonly type: "mesh";
  readonly id: number;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly error?: string;
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<MeshWorkerRequest>) => void) | null;
  postMessage: (message: MeshWorkerResponse, transfer?: Transferable[]) => void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent<MeshWorkerRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== "mesh") return;

  try {
    const solid = buildField(msg.field);
    const mesh = fieldToMesh(solid, msg.quality);
    const response: MeshWorkerResponse = {
      type: "mesh",
      id: msg.id,
      positions: mesh.positions,
      indices: mesh.indices,
    };
    // Transfer buffers to avoid copy
    scope.postMessage(response, [
      mesh.positions.buffer,
      mesh.indices.buffer,
    ]);
  } catch (err) {
    const response: MeshWorkerResponse = {
      type: "mesh",
      id: msg.id,
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      error: err instanceof Error ? err.message : String(err),
    };
    scope.postMessage(response);
  }
};
