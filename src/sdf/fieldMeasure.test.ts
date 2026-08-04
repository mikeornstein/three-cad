/**
 * Field-based measure — planar + freeform surfaces from the SDF, not the op-tree.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHardUnionDemoFieldSolid } from "../demo/createDemoSolid";
import {
  MICRON_MM,
  measureEdgeOnField,
  measurePlanarFaceFromField,
  measureSurfaceFromField,
  nearlyEqual,
  projectToSurface,
} from "./fieldMeasure";

const TOL = MICRON_MM;
const AREA_TOL = 0.5;
/** Freeform solid-angle estimate: a few hundred mm² is fine. */
const FREEFORM_AREA_TOL = 200;

// Analytic cut-face formulas assume hard min-union (not the smooth-union product demo).
describe("measureSurfaceFromField: hard-union cube ∪ sphere", () => {
  const field = createHardUnionDemoFieldSolid();
  const cutExpect = 10_000 - (Math.PI * 50 * 50) / 4;
  /** Exterior sphere surface ≈ 7/8 of full sphere (one octant buried in cube). */
  const sphereExpect = 4 * Math.PI * 50 * 50 * (7 / 8);

  it("full planar −y is exact 100×100", () => {
    const m = measureSurfaceFromField(field, [50, 0, 50], {
      leafId: "demo-cube",
      normalHint: [0, -1, 0],
    });
    assert.ok(m);
    assert.equal(m.planar, true);
    assert.equal(m.rectangular, true);
    assert.ok(nearlyEqual(m.area, 10_000, TOL));
    assert.ok(nearlyEqual(m.width!, 100, TOL));
    assert.ok(nearlyEqual(m.height!, 100, TOL));
  });

  it("full planar −x is exact 100×100", () => {
    const m = measureSurfaceFromField(field, [0, 50, 50], {
      leafId: "demo-cube",
      normalHint: [-1, 0, 0],
    });
    assert.ok(m);
    assert.equal(m.planar, true);
    assert.equal(m.rectangular, true);
    assert.ok(nearlyEqual(m.area, 10_000, TOL), `area ${m.area}`);
  });

  it("+x cut planar is square minus quarter-disk (not bbox)", () => {
    const m = measureSurfaceFromField(field, [100, 40, 40], {
      leafId: "demo-cube",
      normalHint: [1, 0, 0],
    });
    assert.ok(m);
    assert.equal(m.planar, true);
    assert.equal(m.rectangular, false);
    assert.ok(
      nearlyEqual(m.area, cutExpect, AREA_TOL),
      `area ${m.area} ≉ ${cutExpect}`,
    );
    // Must not report uncut AABB.
    assert.ok(Math.abs(m.area - 10_000) > 100);
  });

  it("+y and +z cut faces match +x area", () => {
    for (const seed of [
      [40, 100, 40],
      [40, 40, 100],
    ] as const) {
      const m = measureSurfaceFromField(field, [...seed], {
        leafId: "demo-cube",
      });
      assert.ok(m, `seed ${seed}`);
      assert.equal(m.planar, true);
      assert.equal(m.rectangular, false);
      assert.ok(
        nearlyEqual(m.area, cutExpect, AREA_TOL),
        `seed ${seed} area ${m.area}`,
      );
    }
  });

  it("freeform sphere leaf area ≈ 7/8 · 4πr²", () => {
    const m = measureSurfaceFromField(field, [150, 100, 100], {
      leafId: "demo-sphere",
    });
    assert.ok(m);
    assert.equal(m.planar, false);
    assert.ok(
      nearlyEqual(m.area, sphereExpect, FREEFORM_AREA_TOL),
      `sphere area ${m.area} ≉ ${sphereExpect}`,
    );
  });

  it("auto-detects planar vs freeform from seed", () => {
    const plan = measureSurfaceFromField(field, [50, 0, 50]);
    const curve = measureSurfaceFromField(field, [135, 100, 100]);
    assert.ok(plan?.planar);
    assert.ok(curve && !curve.planar);
  });
});

describe("measurePlanarFaceFromField: hard-union cube ∪ sphere", () => {
  const field = createHardUnionDemoFieldSolid();

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
      nearlyEqual(m.area, expect, AREA_TOL),
      `area ${m.area} ≉ ${expect}`,
    );
  });
});

describe("measureEdgeOnField: hard-union cube ∪ sphere", () => {
  const field = createHardUnionDemoFieldSolid();

  it("extends a mesh seed on a full cube edge to 100 mm", () => {
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
    for (const p of [m.a, m.b]) {
      assert.ok(Math.abs(field.evaluate(p[0], p[1], p[2])) < 1e-4);
    }
  });

  it("clipped cube edge near sphere measures ~50 mm", () => {
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
