/**
 * Topology geometry within 1 µm of field-grounded truth for the demo solid.
 * Face areas are field-measured (not mesh triangle sums).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoSolid } from "../demo/createDemoSolid";
import { attachFieldFaceMetrics } from "../measure/measureSelection";
import { MICRON_MM, nearlyEqual, nearlyEqualVec } from "../sdf/exactFeatures";
import type { Vec3 } from "../sdf/types";
import { buildTopologyIndex } from "./topology";

const TOL = MICRON_MM;
/** Area tolerance (mm²) for field grid integration on cut faces. */
const AREA_TOL = 0.5;

describe("topology exact geometry: demo cube ∪ sphere", () => {
  const mesh = createDemoSolid();
  const topo = buildTopologyIndex([mesh]);
  const solid = topo.solids[0]!;
  attachFieldFaceMetrics(solid);

  it("attaches field and marks edges/verts exact", () => {
    assert.ok(solid.field, "solid should carry fieldSolid");
    assert.ok(solid.vertices.length > 0);
    assert.ok(solid.edges.length > 0);
    assert.ok(solid.vertices.every((v) => v.exact === true));
    assert.ok(solid.edges.every((e) => e.exact === true));
    assert.ok(solid.edges.every((e) => e.length !== undefined));
  });

  it("vertex positions match constructive corners within 1 µm", () => {
    const expected: Vec3[] = [
      [0, 0, 0],
      [100, 0, 0],
      [0, 100, 0],
      [0, 0, 100],
      [100, 100, 0],
      [100, 0, 100],
      [0, 100, 100],
      [100, 100, 50],
      [100, 50, 100],
      [50, 100, 100],
    ];
    assert.equal(solid.vertices.length, expected.length);
    for (const p of expected) {
      const hit = solid.vertices.some((v) =>
        nearlyEqualVec([v.position.x, v.position.y, v.position.z], p, TOL),
      );
      assert.ok(hit, `missing exact vertex near ${p}`);
    }
    // No MC inset junk like (0, 1.5, 1.5)
    for (const v of solid.vertices) {
      const coords = [v.position.x, v.position.y, v.position.z];
      for (const c of coords) {
        // every coordinate is an exact combinatorial value from the set
        const allowed = [0, 50, 100];
        assert.ok(
          allowed.some((a) => nearlyEqual(c, a, TOL)),
          `non-exact coordinate ${c} at ${coords}`,
        );
      }
    }
  });

  it("edge lengths are exact (9×100, 3×50, 3×25π) within 1 µm", () => {
    const lengths = solid.edges.map((e) => e.length!).sort((a, b) => b - a);
    assert.equal(solid.edges.length, 15);

    const countNear = (target: number): number =>
      lengths.filter((L) => nearlyEqual(L, target, TOL)).length;

    assert.equal(countNear(100), 9, "nine full cube edges of 100 mm");
    assert.equal(countNear(50), 3, "three clipped cube edges of 50 mm");
    assert.equal(countNear(25 * Math.PI), 3, "three quarter-circle arcs");

    // Endpoints also exact
    for (const e of solid.edges) {
      const a: Vec3 = [e.a.x, e.a.y, e.a.z];
      const b: Vec3 = [e.b.x, e.b.y, e.b.z];
      const aOk = solid.vertices.some((v) =>
        nearlyEqualVec([v.position.x, v.position.y, v.position.z], a, TOL),
      );
      const bOk = solid.vertices.some((v) =>
        nearlyEqualVec([v.position.x, v.position.y, v.position.z], b, TOL),
      );
      assert.ok(aOk, `edge ${e.id} start not an exact vertex`);
      assert.ok(bOk, `edge ${e.id} end not an exact vertex`);
    }
  });

  it("full cube faces have field area 100×100 mm² (not mesh ~9716)", () => {
    const fullBuckets = ["-x", "-y", "-z"];
    for (const bucket of fullBuckets) {
      const face = solid.faces.find(
        (f) =>
          f.leafId === "demo-cube" && f.localId.includes(`/${bucket}/`),
      );
      assert.ok(face, `missing cube face ${bucket}`);
      assert.ok(face.exact, `${bucket} should be field-measured`);
      assert.ok(
        nearlyEqual(face.area!, 10_000, TOL),
        `${face.localId} area ${face.area} ≉ 10000 (1 µm linear → ~same for w×h)`,
      );
    }
    // Explicit id the user quoted
    const negY = solid.faces.find((f) =>
      f.id.includes("leaf:demo-cube/-y/"),
    );
    assert.ok(negY);
    assert.ok(nearlyEqual(negY.area!, 10_000, TOL));
  });

  it("sphere-cut cube faces have area 10000 − π·50²/4 within grid tol", () => {
    const expect = 10_000 - (Math.PI * 50 * 50) / 4;
    for (const bucket of ["+x", "+y", "+z"]) {
      const face = solid.faces.find(
        (f) =>
          f.leafId === "demo-cube" && f.localId.includes(`/${bucket}/`),
      );
      assert.ok(face, `missing cube face ${bucket}`);
      assert.ok(face.exact);
      assert.ok(
        nearlyEqual(face.area!, expect, AREA_TOL),
        `${face.localId} area ${face.area} ≉ ${expect}`,
      );
    }
  });
});
