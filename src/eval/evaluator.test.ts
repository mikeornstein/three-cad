import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEMO_CYL_SMOOTH_UNION_K_MM,
  DEMO_DRILL_AXIS_MAX,
  DEMO_DRILL_AXIS_MIN,
  DEMO_SMOOTH_UNION_K_MM,
  demoPartDef,
} from "../document/demoDocument";
import {
  boxSolid,
  cylinderSolid,
  difference,
  smoothUnion,
  sphereSolid,
} from "../sdf";
import { buildField } from "./buildField";
import {
  FieldEvaluator,
  hashPart,
  resetDefaultEvaluator,
} from "./evaluator";

describe("buildField", () => {
  it("matches hand-built demo: cut cube then soft-union sphere", () => {
    const fromTree = buildField(demoPartDef().payload.field);
    // Build order: cube → smooth-unioned cyls (100% overshoot) → cut cube → soft-union sphere
    const lo = DEMO_DRILL_AXIS_MIN;
    const hi = DEMO_DRILL_AXIS_MAX;
    const unionedCyls = smoothUnion(
      smoothUnion(
        cylinderSolid([50, 50], 40, lo, hi, "demo-cyl-x", "x"),
        cylinderSolid([50, 50], 40, lo, hi, "demo-cyl-y", "y"),
        DEMO_CYL_SMOOTH_UNION_K_MM,
      ),
      cylinderSolid([50, 50], 40, lo, hi, "demo-cyl-z", "z"),
      DEMO_CYL_SMOOTH_UNION_K_MM,
      "unioned-cyls",
    );
    const cutCube = difference(
      boxSolid([0, 0, 0], [100, 100, 100], "demo-cube"),
      unionedCyls,
      "cut-cube",
    );
    const hand = smoothUnion(
      cutCube,
      sphereSolid([100, 100, 100], 50, "demo-sphere"),
      DEMO_SMOOTH_UNION_K_MM,
      "demo-union",
    );

    const samples: [number, number, number][] = [
      [10, 10, 10], // solid corner of cut cube
      [50, 50, 50], // centroid — inside the cross-drill (air)
      [0, 0, 0],
      [100, 100, 100],
      [150, 100, 100],
      [200, 200, 200],
      [-1, 50, 50],
    ];
    for (const [x, y, z] of samples) {
      assert.ok(
        Math.abs(fromTree.evaluate(x, y, z) - hand.evaluate(x, y, z)) < 1e-12,
        `mismatch at ${x},${y},${z}`,
      );
    }
    assert.equal(fromTree.leafId, "demo-union");
    assert.ok(fromTree.evaluate(10, 10, 10) < 0);
    assert.ok(fromTree.evaluate(50, 50, 50) > 0);
    assert.equal(fromTree.leafAt?.(10, 10, 10), "demo-cube");
    assert.equal(fromTree.leafAt?.(140, 100, 100), "demo-sphere");
  });
});

describe("FieldEvaluator", () => {
  it("caches field and mesh by definition hash", () => {
    const evalr = new FieldEvaluator();
    const part = demoPartDef();
    const quality = { cellSizeMm: 5 }; // coarse for speed

    const a = evalr.evaluatePart(part, quality);
    const b = evalr.evaluatePart(part, quality);

    assert.equal(a.definitionHash, b.definitionHash);
    assert.equal(a.definitionHash, hashPart(part));
    assert.equal(a.cacheHit.field, false);
    assert.equal(a.cacheHit.mesh, false);
    assert.equal(b.cacheHit.field, true);
    assert.equal(b.cacheHit.mesh, true);
    assert.equal(a.field, b.field);
    assert.equal(a.mesh, b.mesh);

    const stats = evalr.stats();
    assert.equal(stats.fieldEntries, 1);
    assert.equal(stats.meshEntries, 1);
    assert.ok(stats.fieldHits >= 1);
    assert.ok(stats.meshHits >= 1);
  });

  it("does not share mesh across quality levels", () => {
    const evalr = new FieldEvaluator();
    const part = demoPartDef();
    const coarse = evalr.evaluatePart(part, { cellSizeMm: 8 });
    const fine = evalr.evaluatePart(part, { cellSizeMm: 4 });

    assert.equal(coarse.definitionHash, fine.definitionHash);
    assert.equal(coarse.cacheHit.mesh, false);
    assert.equal(fine.cacheHit.field, true);
    assert.equal(fine.cacheHit.mesh, false);
    assert.notEqual(coarse.mesh, fine.mesh);
    assert.equal(evalr.stats().meshEntries, 2);
    assert.equal(evalr.stats().fieldEntries, 1);
  });

  it("shares field across different part ids with same payload", () => {
    const evalr = new FieldEvaluator();
    const a = demoPartDef();
    const b = { ...a, id: "clone" };
    const fa = evalr.getField(a);
    const fb = evalr.getField(b);
    assert.equal(fa.definitionHash, fb.definitionHash);
    assert.equal(fa.fieldCacheHit, false);
    assert.equal(fb.fieldCacheHit, true);
    assert.equal(fa.field, fb.field);
  });
});

describe("default evaluator", () => {
  it("reset clears singleton", () => {
    resetDefaultEvaluator();
    // smoke: createDemo path uses default; just ensure reset does not throw
    resetDefaultEvaluator();
  });
});
