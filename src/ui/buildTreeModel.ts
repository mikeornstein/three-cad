/**
 * Pure model: PartDef / FieldNode → nested build-tree rows for the UI.
 * No DOM / Three — unit-testable construction labels.
 */

import type { FieldNode } from "../document/fieldDef";
import type { PartDef } from "../document/types";
import { hashPart } from "../eval/evaluator";
import type { Vec3 } from "../sdf/types";

export interface BuildTreeNode {
  /** Stable path within this tree, e.g. `part/field/a`. */
  readonly path: string;
  /** Op kind, or `part` for the part root. */
  readonly op: string;
  /** Primary label line. */
  readonly title: string;
  /** Secondary muted detail (params). */
  readonly detail?: string;
  /** CSG leaf / material id when present. */
  readonly leafId?: string;
  readonly children?: readonly BuildTreeNode[];
}

/** One-line clipboard / console summary for a tree row. */
export function buildTreeSummary(node: BuildTreeNode): string {
  const parts = [node.op];
  if (node.leafId) parts.push(`leaf:${node.leafId}`);
  if (node.detail) parts.push(node.detail);
  else if (node.title !== node.op && !node.title.startsWith(node.op)) {
    parts.push(node.title);
  }
  return parts.join(" · ");
}

export function partToBuildTree(part: PartDef): BuildTreeNode {
  const hash = hashPart(part);
  const shortHash = hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
  const name = part.attributes?.name?.trim() || part.id;
  const field = fieldNodeToBuildTree(part.payload.field, "part/field");
  return {
    path: "part",
    op: "part",
    title: name,
    detail: `${part.kind} · ${part.id} · ${shortHash}`,
    children: [field],
  };
}

export function fieldNodeToBuildTree(
  node: FieldNode,
  path = "field",
): BuildTreeNode {
  switch (node.op) {
    case "box": {
      const sx = node.max[0] - node.min[0];
      const sy = node.max[1] - node.min[1];
      const sz = node.max[2] - node.min[2];
      return {
        path,
        op: "box",
        title: titleWithLeaf("box", node.leafId),
        detail: `${fmtSize(sx, sy, sz)} · ${fmtCorner(node.min)}→${fmtCorner(node.max)}`,
        leafId: node.leafId,
      };
    }
    case "sphere":
      return {
        path,
        op: "sphere",
        title: titleWithLeaf("sphere", node.leafId),
        detail: `r=${fmtNum(node.radius)} · ⌀${fmtNum(node.radius * 2)} @ ${fmtCorner(node.center)}`,
        leafId: node.leafId,
      };
    case "cylinder": {
      const axis = node.axis ?? "z";
      return {
        path,
        op: "cylinder",
        title: titleWithLeaf("cylinder", node.leafId),
        detail: `⌀${fmtNum(node.radius * 2)} · ${axis}-axis ${fmtNum(node.zMin)}…${fmtNum(node.zMax)} · center ${fmtPair(node.centerXy)}`,
        leafId: node.leafId,
      };
    }
    case "union":
    case "intersection":
    case "difference":
      return {
        path,
        op: node.op,
        title: titleWithLeaf(node.op, node.leafId),
        detail: "2 children",
        leafId: node.leafId,
        children: [
          fieldNodeToBuildTree(node.a, `${path}/a`),
          fieldNodeToBuildTree(node.b, `${path}/b`),
        ],
      };
    case "smoothUnion":
      return {
        path,
        op: "smoothUnion",
        title: titleWithLeaf("smoothUnion", node.leafId),
        detail: `k=${fmtNum(node.k)} · 2 children`,
        leafId: node.leafId,
        children: [
          fieldNodeToBuildTree(node.a, `${path}/a`),
          fieldNodeToBuildTree(node.b, `${path}/b`),
        ],
      };
    case "translate":
      return {
        path,
        op: "translate",
        title: "translate",
        detail: fmtCorner(node.offset),
        children: [fieldNodeToBuildTree(node.solid, `${path}/solid`)],
      };
    case "offset":
      return {
        path,
        op: "offset",
        title: titleWithLeaf("offset", node.leafId),
        detail: `Δ=${fmtNum(node.delta)} mm`,
        leafId: node.leafId,
        children: [fieldNodeToBuildTree(node.solid, `${path}/solid`)],
      };
    default: {
      const _exhaustive: never = node;
      throw new Error(
        `fieldNodeToBuildTree: unknown op ${(_exhaustive as FieldNode).op}`,
      );
    }
  }
}

function titleWithLeaf(op: string, leafId?: string): string {
  return leafId ? `${op}  ${leafId}` : op;
}

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(3).replace(/\.?0+$/, "");
  return s || "0";
}

function fmtSize(x: number, y: number, z: number): string {
  return `${fmtNum(x)}×${fmtNum(y)}×${fmtNum(z)} mm`;
}

function fmtCorner(v: Vec3): string {
  return `(${fmtNum(v[0])},${fmtNum(v[1])},${fmtNum(v[2])})`;
}

function fmtPair(v: readonly [number, number]): string {
  return `(${fmtNum(v[0])},${fmtNum(v[1])})`;
}
