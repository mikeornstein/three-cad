import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoFieldNode } from "../document/demoDocument";
import { buildField } from "../eval/buildField";
import { growSurfaceRegion } from "./fieldRegion";

describe("growSurfaceRegion", () => {
  const field = buildField(demoFieldNode());

  it("separates cube +x and +y planar faces", () => {
    const rx = growSurfaceRegion(field, [100, 50, 50]);
    const ry = growSurfaceRegion(field, [50, 100, 50]);
    assert.ok(rx && ry);
    assert.equal(rx!.planar, true);
    assert.equal(ry!.planar, true);
    assert.equal(rx!.regionKey, "demo-cube/+x");
    assert.equal(ry!.regionKey, "demo-cube/+y");
    assert.notEqual(rx!.regionKey, ry!.regionKey);
    // Mean normals roughly axis-aligned
    assert.ok(rx!.meanNormal[0] > 0.9);
    assert.ok(ry!.meanNormal[1] > 0.9);
  });

  it("grows -z cube face without jumping to sphere", () => {
    const r = growSurfaceRegion(field, [40, 40, 0]);
    assert.ok(r);
    assert.equal(r!.regionKey, "demo-cube/-z");
    assert.equal(r!.leafId, "demo-cube");
    assert.ok(r!.samples.length > 4);
  });

  it("treats sphere as one curved region", () => {
    // Point on sphere away from cube (outer ++++ octant)
    const r = growSurfaceRegion(field, [130, 100, 100]);
    assert.ok(r);
    assert.equal(r!.planar, false);
    assert.equal(r!.regionKey, "demo-sphere/curved");
    assert.equal(r!.leafId, "demo-sphere");
  });

  it("does not require a mesh", () => {
    const r = growSurfaceRegion(field, [0, 50, 50]);
    assert.ok(r);
    assert.equal(r!.regionKey, "demo-cube/-x");
  });
});
