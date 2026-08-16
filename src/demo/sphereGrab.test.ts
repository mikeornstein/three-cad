import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Ray, Vector3 } from "three";
import {
  grabCenterFromHit,
  hitPadMm,
  rayHitsSphere,
  reduceGrabPhase,
  SLOP_PX,
  type GrabPhase,
} from "./sphereGrab";

describe("reduceGrabPhase", () => {
  it("starts pending on sphere hit from idle", () => {
    assert.equal(reduceGrabPhase("idle", { type: "down-on-sphere" }), "pending");
  });

  it("cancels pending when movement exceeds slop", () => {
    const next = reduceGrabPhase("pending", {
      type: "move",
      movedPx: SLOP_PX + 1,
      slopPx: SLOP_PX,
    });
    assert.equal(next, "idle");
  });

  it("stays pending when movement is within slop", () => {
    const next = reduceGrabPhase("pending", {
      type: "move",
      movedPx: SLOP_PX,
      slopPx: SLOP_PX,
    });
    assert.equal(next, "pending");
  });

  it("enters grabbing when hold fires while pending", () => {
    assert.equal(reduceGrabPhase("pending", { type: "hold" }), "grabbing");
  });

  it("ignores hold after slop already cancelled", () => {
    assert.equal(reduceGrabPhase("idle", { type: "hold" }), "idle");
  });

  it("returns to idle on pointer up from pending or grabbing", () => {
    assert.equal(reduceGrabPhase("pending", { type: "up" }), "idle");
    assert.equal(reduceGrabPhase("grabbing", { type: "up" }), "idle");
  });

  it("does not start a second pending while grabbing", () => {
    const phase: GrabPhase = "grabbing";
    assert.equal(reduceGrabPhase(phase, { type: "down-on-sphere" }), "grabbing");
  });
});

describe("rayHitsSphere", () => {
  const center = new Vector3(100, 100, 100);
  const radius = 50;
  const out = new Vector3();

  it("hits a ray aimed at the sphere center", () => {
    const origin = new Vector3(100, 100, 300);
    const dir = new Vector3(0, 0, -1);
    assert.equal(rayHitsSphere(new Ray(origin, dir), center, radius, out), true);
    assert.ok(Math.abs(out.z - 150) < 1e-6);
  });

  it("misses a ray that clears the sphere", () => {
    const origin = new Vector3(0, 0, 300);
    const dir = new Vector3(0, 0, -1);
    assert.equal(rayHitsSphere(new Ray(origin, dir), center, radius, out), false);
  });

  it("hits when pad grows the radius enough to cover the ray", () => {
    const origin = new Vector3(100, 100, 300);
    const dir = new Vector3(0, 0, -1);
    const grazed = new Vector3(100, 156, 100);
    assert.equal(rayHitsSphere(new Ray(origin, dir), grazed, radius, out), false);
    assert.equal(
      rayHitsSphere(new Ray(origin, dir), grazed, radius + hitPadMm(true), out),
      true,
    );
  });
});

describe("grabCenterFromHit", () => {
  const workMin = new Vector3(-10, -10, -10);
  const workMax = new Vector3(400, 400, 400);
  const out = new Vector3();

  it("applies offset so the sphere does not snap to the pointer", () => {
    const planeHit = new Vector3(120, 100, 80);
    const offset = new Vector3(-20, 0, 20);
    grabCenterFromHit(planeHit, offset, workMin, workMax, out);
    assert.deepEqual(out.toArray(), [100, 100, 100]);
    assert.notDeepEqual(out.toArray(), planeHit.toArray());
  });

  it("clamps to the workspace box", () => {
    const planeHit = new Vector3(500, 0, 0);
    const offset = new Vector3(0, 0, 0);
    grabCenterFromHit(planeHit, offset, workMin, workMax, out);
    assert.equal(out.x, 400);
  });
});

describe("hitPadMm", () => {
  it("is larger for coarse / touch pointers", () => {
    assert.equal(hitPadMm(false), 2);
    assert.equal(hitPadMm(true), 8);
  });
});
