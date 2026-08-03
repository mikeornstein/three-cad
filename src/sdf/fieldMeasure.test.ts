/**
 * Field-based planar face measure — independent of mesh tessellation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoFieldSolid } from "../demo/createDemoSolid";
import { MICRON_MM, nearlyEqual } from "./exactFeatures";
import { measurePlanarFaceFromField } from "./fieldMeasure";

const TOL = MICRON_MM;

describe("measurePlanarFaceFromField: demo cube ∪ sphere", () => {
  const field = createDemoFieldSolid();

  it("-y face is exactly 100×100 mm (field, not mesh)", () => {
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
    // Grid integration — allow 0.5 mm²
    assert.ok(
      nearlyEqual(m.area, expect, 0.5),
      `area ${m.area} ≉ ${expect}`,
    );
  });
});
