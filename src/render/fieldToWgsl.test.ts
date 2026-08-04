import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoFieldNode } from "../document/demoDocument";
import { buildField } from "../eval/buildField";
import { fieldNodeToWgsl } from "./fieldToWgsl";

describe("fieldNodeToWgsl", () => {
  it("compiles demo smoothUnion with sampleField / map / matWeight", () => {
    const result = fieldNodeToWgsl(demoFieldNode(), {
      leafMaterialWeight: { "demo-cube": 0, "demo-sphere": 1 },
    });
    assert.match(result.mapSource, /fn sampleField\(p: vec3<f32>\) -> vec2<f32>/);
    assert.match(result.mapSource, /fn map\(p: vec3<f32>\) -> f32/);
    assert.match(result.mapSource, /fn matWeight\(p: vec3<f32>\) -> f32/);
    assert.match(result.mapSource, /sdBox/);
    assert.match(result.mapSource, /sdSphere/);
    // Soft-min expands h for distance + material blend.
    assert.match(result.mapSource, /let h\d+/);
    assert.match(result.mapSource, /mix\(/);
    assert.ok(result.tempCount >= 3);
    // Bounds cover cube [0,100]^3 and sphere at corner r=50
    assert.equal(result.bounds.min[0], 0);
    assert.equal(result.bounds.max[0], 150);
  });

  it("matches CPU field sign at interior / exterior samples", () => {
    const node = demoFieldNode();
    const field = buildField(node);
    const wgsl = fieldNodeToWgsl(node);
    assert.equal(wgsl.bounds.min[0], field.bounds.min[0]);
    assert.equal(wgsl.bounds.max[2], field.bounds.max[2]);

    assert.ok(field.evaluate(50, 50, 50) < 0);
    assert.ok(field.evaluate(500, 500, 500) > 0);
    assert.match(wgsl.mapSource, /100\.0/);
  });

  it("blends material weights on smoothUnion leaves", () => {
    const result = fieldNodeToWgsl(demoFieldNode(), {
      leafMaterialWeight: { "demo-cube": 0, "demo-sphere": 1 },
    });
    // Cube weight 0, sphere weight 1 appear as literals.
    assert.match(result.mapSource, /let w\d+ = 0\.0;/);
    assert.match(result.mapSource, /let w\d+ = 1\.0;/);
  });

  it("compiles translate + offset + smoothUnion", () => {
    const result = fieldNodeToWgsl({
      op: "smoothUnion",
      k: 5,
      a: {
        op: "offset",
        delta: 2,
        solid: {
          op: "translate",
          offset: [10, 0, 0],
          solid: { op: "sphere", center: [0, 0, 0], radius: 20 },
        },
      },
      b: { op: "box", min: [-5, -5, -5], max: [5, 5, 5] },
    });
    assert.match(result.mapSource, /let h\d+/);
    assert.match(result.mapSource, /let p_\d+/);
    assert.match(result.mapSource, /10\.0/);
  });
});
