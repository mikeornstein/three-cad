/**
 * Topology vertex positions and edge lengths must match constructive defs
 * within 1 micron when field source is available.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDemoSolid } from "../demo/createDemoSolid";
import { MICRON_MM, nearlyEqual, nearlyEqualVec } from "../sdf/exactFeatures";
import type { Vec3 } from "../sdf/types";
import { buildTopologyIndex } from "./topology";

const TOL = MICRON_MM;

describe("topology exact geometry: demo cube ∪ sphere", () => {
  const mesh = createDemoSolid();
  const topo = buildTopologyIndex([mesh]);
  const solid = topo.solids[0]!;

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
});
