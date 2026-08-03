/**
 * Field-based measure — planar faces and edges from the SDF, not the op-tree.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoFieldSolid } from "../demo/createDemoSolid";
import {
  MICRON_MM,
  measureEdgeOnField,
  measurePlanarFaceFromField,
  nearlyEqual,
  projectToSurface,
} from "./fieldMeasure";

const TOL = MICRON_MM;

describe("measurePlanarFaceFromField: demo cube ∪ sphere", () => {
  const field = createDemoFieldSolid();

  it("-y face is 100×100 mm from the field (not mesh)", () => {
    const m = measurePlanarFaceFromField(field, [50, 0, 50], {
      leafId: "demo-cube",
      normalHint: [0, -1, 0],
    });
    assert.ok(m);
    assert.equal(m.rectangular, true);
    assert.ok(nearlyEqual(m.width!, 100, TOL));
    assert.ok(nearlyEqual(m.height!, 100, TOL));
    assert.ok(nearlyEqual(m.area, 10_000, TOL));
  });

  it("+x face area is square minus quarter-disk (field)", () => {
    const expect = 10_000 - (Math.PI * 50 * 50) / 4;
    const m = measurePlanarFaceFromField(field, [100, 40, 40], {
      leafId: "demo-cube",
      normalHint: [1, 0, 0],
    });
    assert.ok(m);
    assert.equal(m.rectangular, false);
    assert.ok(
      nearlyEqual(m.area, expect, 0.5),
      `area ${m.area} ≉ ${expect}`,
    );
  });
});

describe("measureEdgeOnField: demo cube ∪ sphere", () => {
  const field = createDemoFieldSolid();

  it("extends a mesh seed on a full cube edge to 100 mm", () => {
    // Inset MC-like seed along -z bottom front edge (y=0,z=0)
    const seed = [
      { x: 10, y: 0, z: 0 },
      { x: 50, y: 0, z: 0 },
      { x: 90, y: 0, z: 0 },
    ];
    const m = measureEdgeOnField(field, seed);
    assert.ok(m);
    assert.equal(m.linear, true);
    assert.ok(
      nearlyEqual(m.length, 100, 0.05),
      `length ${m.length} ≉ 100`,
    );
    // Endpoints on surface
    for (const p of [m.a, m.b]) {
      assert.ok(Math.abs(field.evaluate(p[0], p[1], p[2])) < 1e-4);
    }
  });

  it("clipped cube edge near sphere measures ~50 mm", () => {
    // Edge (100,100,z) from z=0 toward sphere at z=50
    const seed = [
      { x: 100, y: 100, z: 5 },
      { x: 100, y: 100, z: 20 },
      { x: 100, y: 100, z: 40 },
    ];
    const m = measureEdgeOnField(field, seed);
    assert.ok(m);
    assert.ok(
      nearlyEqual(m.length, 50, 0.1),
      `length ${m.length} ≉ 50`,
    );
  });

  it("projectToSurface lands on f ≈ 0", () => {
    const p = projectToSurface(field, 50, -10, 50);
    assert.ok(p);
    assert.ok(Math.abs(field.evaluate(p[0], p[1], p[2])) < 1e-4);
  });
});
