/**
 * Main-thread client for the mesh worker.
 * Falls back to sync fieldToMesh when workers are unavailable (tests / SSR).
 */

import type { FieldNode } from "../../document/fieldDef";
import { fieldToMesh, type DerivedMesh, type MeshQuality } from "../../sdf";
import { buildField } from "../buildField";
import type { MeshWorkerRequest, MeshWorkerResponse } from "./meshWorker";

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<
  number,
  {
    resolve: (mesh: DerivedMesh) => void;
    reject: (err: Error) => void;
  }
>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") {
    worker = null;
    return null;
  }
  try {
    worker = new Worker(new URL("./meshWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<MeshWorkerResponse>) => {
      const msg = event.data;
      if (!msg || msg.type !== "mesh") return;
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.error) {
        slot.reject(new Error(msg.error));
        return;
      }
      slot.resolve({ positions: msg.positions, indices: msg.indices });
    };
    worker.onerror = (ev) => {
      for (const [, slot] of pending) {
        slot.reject(new Error(ev.message || "mesh worker error"));
      }
      pending.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Tessellate a field node, preferring a worker when available. */
export function meshFieldNode(
  field: FieldNode,
  quality: MeshQuality,
): Promise<DerivedMesh> {
  const w = getWorker();
  if (!w) {
    const solid = buildField(field);
    return Promise.resolve(fieldToMesh(solid, quality));
  }

  const id = nextId++;
  return new Promise<DerivedMesh>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: MeshWorkerRequest = {
      type: "mesh",
      id,
      field,
      quality,
    };
    w.postMessage(req);
  });
}

/** Tear down worker (tests / hot reload). */
export function disposeMeshWorker(): void {
  if (worker) {
    worker.terminate();
  }
  worker = undefined;
  pending.clear();
}
