import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Ray, Vector3 } from "three";
import type { LiveSphereHandle } from "../render/createFieldRayMarchMesh";
import type { LiveTranslateHandle } from "../render/createFieldRayMarchMesh";
import {
  ClosestBodyPicker,
  LiveBoxPicker,
  LiveSpherePicker,
} from "./pickBody";

function fakeSphere(center: Vector3, radius: number): LiveSphereHandle {
  const c = center.clone();
  let r = radius;
  return {
    leafId: "demo-sphere",
    restCenter: center.clone(),
    restRadius: radius,
    setCenter(v) {
      if (v instanceof Vector3) c.copy(v);
      else c.set(v[0], v[1], v[2]);
    },
    setRadius(next) {
      r = next;
    },
    getCenter(out = new Vector3()) {
      return out.copy(c);
    },
    getRadius() {
      return r;
    },
  };
}

function fakeCube(offset = new Vector3()): LiveTranslateHandle {
  const rest = new Vector3(50, 50, 50);
  const o = offset.clone();
  return {
    leafId: "cut-cube",
    restCenter: rest.clone(),
    setOffset(v) {
      if (v instanceof Vector3) o.copy(v);
      else o.set(v[0], v[1], v[2]);
    },
    getOffset(out = new Vector3()) {
      return out.copy(o);
    },
    setCenter(v) {
      if (v instanceof Vector3) o.copy(v).sub(rest);
      else o.set(v[0] - rest.x, v[1] - rest.y, v[2] - rest.z);
    },
    getCenter(out = new Vector3()) {
      return out.copy(rest).add(o);
    },
  };
}

describe("LiveSpherePicker / LiveBoxPicker / ClosestBodyPicker", () => {
  const pad = () => 0;
  const sphere = fakeSphere(new Vector3(100, 100, 100), 50);
  const cube = fakeCube();
  const spherePick = new LiveSpherePicker(sphere, pad);
  const cubePick = new LiveBoxPicker(
    cube,
    new Vector3(0, 0, 0),
    new Vector3(100, 100, 100),
    pad,
  );
  const closest = new ClosestBodyPicker([spherePick, cubePick]);

  it("hits the cube AABB from +Y and misses a ray that clears it", () => {
    const hitRay = new Ray(new Vector3(50, 300, 50), new Vector3(0, -1, 0));
    assert.equal(cubePick.pick(hitRay), "cut-cube");
    const miss = new Ray(new Vector3(200, 300, 50), new Vector3(0, -1, 0));
    assert.equal(cubePick.pick(miss), null);
  });

  it("picks the nearer body when both AABBs overlap the ray", () => {
    // From +Z looking at the sphere (closer) then the cube behind/beside.
    const ray = new Ray(new Vector3(100, 100, 300), new Vector3(0, 0, -1));
    assert.equal(closest.pick(ray), "demo-sphere");
    const cubeFace = new Ray(new Vector3(20, 20, 300), new Vector3(0, 0, -1));
    assert.equal(closest.pick(cubeFace), "cut-cube");
  });

  it("follows a live cube offset", () => {
    cube.setOffset(new Vector3(80, 0, 0));
    const ray = new Ray(new Vector3(130, 50, 300), new Vector3(0, 0, -1));
    assert.equal(cubePick.pick(ray), "cut-cube");
    cube.setOffset(new Vector3(0, 0, 0));
    assert.equal(cubePick.pick(ray), null);
  });
});
