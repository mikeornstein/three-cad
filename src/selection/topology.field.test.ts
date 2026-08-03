/**
 * Field-measured topology geometry for the demo solid.
 * Ground truth is the geometry the field represents (not an op-tree walk).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoSolid } from "../demo/createDemoSolid";
import { attachFieldFaceMetrics } from "../measure/measureSelection";
import { MICRON_MM, nearlyEqual } from "../sdf/fieldMeasure";
import { buildTopologyIndex } from "./topology";

const TOL = MICRON_MM;
const AREA_TOL = 0.5;
/** Linear edges extended on the field should hit true cube dimensions. */
const EDGE_LEN_TOL = 0.05;

describe("topology field measure: demo cube ∪ sphere", () => {
  const mesh = createDemoSolid();
  const topo = buildTopologyIndex([mesh]);
  const solid = topo.solids[0]!;
  attachFieldFaceMetrics(solid);

  it("marks edges/verts as field-measured", () => {
    assert.ok(solid.field);
    assert.ok(solid.edges.length > 0);
    assert.ok(solid.vertices.length > 0);
    assert.ok(solid.edges.every((e) => e.fieldMeasured === true));
    assert.ok(solid.edges.every((e) => e.length !== undefined));
    assert.ok(solid.vertices.every((v) => v.fieldMeasured === true));
  });

  it("full cube faces have field area 100×100 mm²", () => {
    for (const bucket of ["-x", "-y", "-z"]) {
      const face = solid.faces.find(
        (f) =>
          f.leafId === "demo-cube" && f.localId.includes(`/${bucket}/`),
      );
      assert.ok(face, `missing ${bucket}`);
      assert.ok(face.fieldMeasured);
      assert.ok(
        nearlyEqual(face.area!, 10_000, TOL),
        `${face.localId} area ${face.area} ≉ 10000`,
      );
    }
    const negY = solid.faces.find((f) =>
      f.id.includes("leaf:demo-cube/-y/"),
    );
    assert.ok(negY);
    assert.ok(nearlyEqual(negY.area!, 10_000, TOL));
  });

  it("sphere-cut cube faces ≈ 10000 − π·50²/4", () => {
    const expect = 10_000 - (Math.PI * 50 * 50) / 4;
    for (const bucket of ["+x", "+y", "+z"]) {
      const face = solid.faces.find(
        (f) =>
          f.leafId === "demo-cube" && f.localId.includes(`/${bucket}/`),
      );
      assert.ok(face, `missing ${bucket}`);
      assert.ok(face.fieldMeasured);
      assert.ok(
        nearlyEqual(face.area!, expect, AREA_TOL),
        `${face.localId} area ${face.area} ≉ ${expect}`,
      );
    }
  });

  it("edge lengths: 9×100, 3×50, 3×25π (field, not mesh)", () => {
    const lengths = solid.edges
      .filter((e) => e.length !== undefined)
      .map((e) => e.length!);
    assert.equal(solid.edges.length, 15, `edge count ${solid.edges.length}`);

    const near = (target: number, tol: number): number =>
      lengths.filter((L) => nearlyEqual(L, target, tol)).length;

    assert.equal(
      near(100, EDGE_LEN_TOL),
      9,
      `expected 9×100 mm edges, lengths=${lengths.map((x) => x.toFixed(2)).join(",")}`,
    );
    assert.equal(
      near(50, EDGE_LEN_TOL),
      3,
      `expected 3×50 mm edges, lengths=${lengths.map((x) => x.toFixed(2)).join(",")}`,
    );
    // Circular-arc fit from chord+sagitta; MC seeds leave ~0.2 mm on length.
    assert.equal(
      near(25 * Math.PI, 0.5),
      3,
      `expected 3×25π arcs, lengths=${lengths.map((x) => x.toFixed(2)).join(",")}`,
    );
  });

  it("field-projected vertices lie on the surface (f ≈ 0)", () => {
    assert.ok(solid.field);
    for (const v of solid.vertices) {
      const f = solid.field.evaluate(
        v.position.x,
        v.position.y,
        v.position.z,
      );
      assert.ok(
        Math.abs(f) <= 1e-3,
        `vertex ${v.id} f=${f} not on surface`,
      );
    }
  });

  it("edge endpoints lie on the surface", () => {
    assert.ok(solid.field);
    for (const e of solid.edges) {
      for (const p of [e.a, e.b]) {
        const f = solid.field.evaluate(p.x, p.y, p.z);
        assert.ok(Math.abs(f) <= 1e-3, `edge ${e.id} end f=${f}`);
      }
    }
  });
});
