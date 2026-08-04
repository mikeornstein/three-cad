import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Vector3 } from "three";
import { demoFieldNode } from "../document/demoDocument";
import { buildField } from "../eval/buildField";
import { sphereTraceField } from "../render/fieldRayPick";
import { densifyRegionForHighlight, growSurfaceRegion } from "./fieldRegion";

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
    assert.ok(rx!.meanNormal[0] > 0.9);
    assert.ok(ry!.meanNormal[1] > 0.9);
  });

  it("grows -z cube face without jumping to sphere", () => {
    const r = growSurfaceRegion(field, [40, 40, 0]);
    assert.ok(r);
    assert.equal(r!.planar, true);
    assert.equal(r!.regionKey, "demo-cube/-z");
    assert.equal(r!.leafId, "demo-cube");
    assert.ok(r!.planeFrame && r!.planeFrame.width > 50);
  });

  it("treats sphere as one curved region (axis pole)", () => {
    const r = growSurfaceRegion(field, [150, 100, 100]);
    assert.ok(r);
    assert.equal(r!.planar, false);
    assert.equal(r!.regionKey, "demo-sphere/curved");
    assert.equal(r!.leafId, "demo-sphere");
    // Freeform should cover a meaningful patch (not a single crease sample).
    assert.ok(r!.samples.length > 50, `samples=${r!.samples.length}`);
  });

  it("grows sphere off-axis (not only poles) — edgeness must not fake creases", () => {
    // Diagonal normal on sphere: |n| components equal → raw edgeness ~0.5
    // but surface is smooth. Grow must still expand a patch.
    const r = growSurfaceRegion(field, [135, 135, 135]);
    assert.ok(r);
    assert.equal(r!.planar, false);
    assert.equal(r!.leafId, "demo-sphere");
    assert.equal(r!.regionKey, "demo-sphere/curved");
    assert.ok(
      r!.samples.length > 30,
      `off-axis sphere samples=${r!.samples.length} (expected patch, not a point)`,
    );
  });

  it("classifies ray-traced sphere hits as freeform face", () => {
    // Camera-like ray toward outer sphere (+X).
    const hit = sphereTraceField(
      field,
      new Vector3(250, 100, 100),
      new Vector3(-1, 0, 0),
    );
    assert.ok(hit);
    assert.equal(hit!.leafId, "demo-sphere");
    const r = growSurfaceRegion(field, [
      hit!.point.x,
      hit!.point.y,
      hit!.point.z,
    ]);
    assert.ok(r);
    assert.equal(r!.regionKey, "demo-sphere/curved");
    assert.equal(r!.planar, false);
  });

  it("does not require a mesh", () => {
    const r = growSurfaceRegion(field, [0, 50, 50]);
    assert.ok(r);
    assert.equal(r!.regionKey, "demo-cube/-x");
  });
});

describe("densifyRegionForHighlight", () => {
  const field = buildField(demoFieldNode());

  it("planar faces provide a full plane frame (PlaneGeometry highlight)", () => {
    const r = growSurfaceRegion(field, [0, 50, 50]);
    assert.ok(r?.planar);
    assert.ok(r!.planeFrame);
    assert.ok(r!.planeFrame!.width > 90);
    assert.ok(r!.planeFrame!.height > 90);
    // densify returns empty for planar — paint uses plane mesh
    const d = densifyRegionForHighlight(field, r!);
    assert.equal(d.positions.length, 0);
  });

  it("produces freeform paint samples covering most of the sphere leaf", () => {
    const r = growSurfaceRegion(field, [150, 100, 100]);
    assert.ok(r);
    const d = densifyRegionForHighlight(field, r!);
    const n = d.positions.length / 3;
    assert.ok(n > 800, `sphere paint points=${n}`);
    assert.equal(d.positions.length, d.normals.length);
    // Span should approach sphere diameter (~100 mm) in each axis.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, d.positions[i * 3]!);
      maxX = Math.max(maxX, d.positions[i * 3]!);
      minY = Math.min(minY, d.positions[i * 3 + 1]!);
      maxY = Math.max(maxY, d.positions[i * 3 + 1]!);
      minZ = Math.min(minZ, d.positions[i * 3 + 2]!);
      maxZ = Math.max(maxZ, d.positions[i * 3 + 2]!);
    }
    assert.ok(maxX - minX > 70, `X span ${maxX - minX}`);
    assert.ok(maxY - minY > 70, `Y span ${maxY - minY}`);
    assert.ok(maxZ - minZ > 70, `Z span ${maxZ - minZ}`);
  });
});
