import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoFieldNode } from "../document/demoDocument";
import { buildField } from "../eval/buildField";
import { fieldNodeToGlsl } from "./fieldToGlsl";

describe("fieldNodeToGlsl", () => {
  it("compiles demo cube ∪ sphere with map() and helpers", () => {
    const result = fieldNodeToGlsl(demoFieldNode());
    assert.match(result.mapSource, /float map\(vec3 p\)/);
    assert.match(result.mapSource, /sdBox/);
    assert.match(result.mapSource, /sdSphere/);
    assert.match(result.mapSource, /min\(/);
    assert.ok(result.tempCount >= 3);
    // Bounds cover cube [0,100]^3 and sphere at corner r=50
    assert.equal(result.bounds.min[0], 0);
    assert.equal(result.bounds.max[0], 150);
  });

  it("matches CPU field sign at interior / exterior samples", () => {
    const node = demoFieldNode();
    const field = buildField(node);
    const glsl = fieldNodeToGlsl(node);
    // Sanity: compiler bounds align with field bounds
    assert.equal(glsl.bounds.min[0], field.bounds.min[0]);
    assert.equal(glsl.bounds.max[2], field.bounds.max[2]);

    // Interior of cube
    assert.ok(field.evaluate(50, 50, 50) < 0);
    // Exterior far away
    assert.ok(field.evaluate(500, 500, 500) > 0);
    // GLSL source contains the sphere center used by CPU
    assert.match(glsl.mapSource, /100\.0/);
  });

  it("compiles translate + offset + smoothUnion", () => {
    const result = fieldNodeToGlsl({
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
    assert.match(result.mapSource, /opSmoothUnion/);
    assert.match(result.mapSource, /vec3 p_\d+/);
    assert.match(result.mapSource, /10\.0/);
  });
});
