/**
 * Exact feature extraction — micron tolerance against constructive defs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoFieldSolid } from "../demo/createDemoSolid";
import {
  exactFeatures,
  MICRON_MM,
  nearlyEqual,
  nearlyEqualVec,
} from "./exactFeatures";
import type { Vec3 } from "./types";

const TOL = MICRON_MM; // 1 µm in mm

function hasVertex(verts: { position: Vec3 }[], p: Vec3): boolean {
  return verts.some((v) => nearlyEqualVec(v.position, p, TOL));
}

function hasLineLength(
  edges: { kind: string; length: number }[],
  length: number,
  count: number,
): boolean {
  const n = edges.filter(
    (e) => e.kind === "line" && nearlyEqual(e.length, length, TOL),
  ).length;
  return n === count;
}

describe("exactFeatures: demo cube ∪ sphere", () => {
  const field = createDemoFieldSolid();
  const exact = exactFeatures(field);

  it("extracts features from field source", () => {
    assert.ok(exact, "exactFeatures should return a set for demo field");
  });

  it("has exact cube corners (7) + sphere∩edge points (3)", () => {
    assert.ok(exact);
    const feat = exact!;
    const expected: Vec3[] = [
      [0, 0, 0],
      [100, 0, 0],
      [0, 100, 0],
      [0, 0, 100],
      [100, 100, 0],
      [100, 0, 100],
      [0, 100, 100],
      // cube edge ∩ sphere (r=50, center 100³)
      [100, 100, 50],
      [100, 50, 100],
      [50, 100, 100],
    ];
    assert.equal(feat.vertices.length, 10);
    for (const p of expected) {
      assert.ok(hasVertex(feat.vertices, p), `missing vertex ${p}`);
    }
    // Interior cube corner is not a surface vertex
    assert.ok(!hasVertex(feat.vertices, [100, 100, 100]));
  });

  it("has 9 full cube edges of 100 mm and 3 clipped of 50 mm", () => {
    assert.ok(exact);
    const feat = exact!;
    const lines = feat.edges.filter((e) => e.kind === "line");
    assert.equal(lines.length, 12);
    assert.ok(hasLineLength(lines, 100, 9), "expected nine 100 mm edges");
    assert.ok(hasLineLength(lines, 50, 3), "expected three 50 mm edges");
  });

  it("has 3 sphere∩cube-face quarter arcs of length 25π mm", () => {
    assert.ok(exact);
    const feat = exact!;
    const arcs = feat.edges.filter((e) => e.kind === "arc");
    assert.equal(arcs.length, 3);
    const expect = 25 * Math.PI;
    for (const a of arcs) {
      assert.ok(
        nearlyEqual(a.length, expect, TOL),
        `arc length ${a.length} ≉ ${expect}`,
      );
      assert.ok(nearlyEqual(a.radius, 50, TOL));
      assert.ok(nearlyEqual(a.angle, Math.PI / 2, TOL));
    }
  });

  it("all edge endpoints are exact vertices", () => {
    assert.ok(exact);
    const feat = exact!;
    for (const e of feat.edges) {
      assert.ok(hasVertex(feat.vertices, e.a), `endpoint A not a vertex: ${e.a}`);
      assert.ok(hasVertex(feat.vertices, e.b), `endpoint B not a vertex: ${e.b}`);
    }
  });
});
