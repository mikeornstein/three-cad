import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Vector3 } from "three";
import { demoFieldNode } from "../document/demoDocument";
import { buildField } from "../eval/buildField";
import { sphereTraceField } from "./fieldRayPick";

describe("sphereTraceField", () => {
  it("hits the demo solid from +X", () => {
    const field = buildField(demoFieldNode());
    // Ray from outside toward cube face at x=100 (sphere extends further)
    const hit = sphereTraceField(
      field,
      new Vector3(200, 50, 50),
      new Vector3(-1, 0, 0),
    );
    assert.ok(hit);
    assert.ok(hit!.point.x < 160 && hit!.point.x > 90);
    assert.ok(Math.abs(hit!.normal.x) > 0.5);
  });

  it("misses when ray points away", () => {
    const field = buildField(demoFieldNode());
    const hit = sphereTraceField(
      field,
      new Vector3(200, 50, 50),
      new Vector3(1, 0, 0),
    );
    assert.equal(hit, null);
  });
});
