import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoFieldNode } from "../document/demoDocument";
import { buildField } from "../eval/buildField";
import { fieldNodeToWgsl } from "./fieldToWgsl";

describe("fieldNodeToWgsl", () => {
  it("compiles demo cut-cube softUnion sphere with sampleField / map / matWeight", () => {
    const result = fieldNodeToWgsl(demoFieldNode(), {
      leafMaterialWeight: { "demo-cube": 0, "demo-sphere": 1 },
    });
    assert.match(
      result.mapSource,
      /fn sampleField\(p: vec3<f32>, hlLeaf: f32\) -> vec3<f32>/,
    );
    assert.match(result.mapSource, /fn map\(p: vec3<f32>\) -> f32/);
    assert.match(result.mapSource, /fn matWeight\(p: vec3<f32>\) -> f32/);
    assert.match(result.mapSource, /sdBox/);
    assert.match(result.mapSource, /sdSphere/);
    assert.match(result.mapSource, /sdCylinderZ/);
    // Soft-min expands h for distance + material blend.
    assert.match(result.mapSource, /let h\d+/);
    assert.match(result.mapSource, /mix\(/);
    assert.ok(result.tempCount >= 3);
    // Bounds cover cut cube [0,100]^3 and sphere at corner r=50
    assert.equal(result.bounds.min[0], 0);
    assert.equal(result.bounds.max[0], 150);
  });

  it("matches CPU field sign at interior / exterior samples", () => {
    const node = demoFieldNode();
    const field = buildField(node);
    const wgsl = fieldNodeToWgsl(node);
    assert.equal(wgsl.bounds.min[0], field.bounds.min[0]);
    assert.equal(wgsl.bounds.max[2], field.bounds.max[2]);

    // Cross-drill leaves cube corners solid; centroid is air.
    assert.ok(field.evaluate(10, 10, 10) < 0);
    assert.ok(field.evaluate(50, 50, 50) > 0);
    assert.ok(field.evaluate(500, 500, 500) > 0);
    assert.match(wgsl.mapSource, /100\.0/);
    assert.match(wgsl.mapSource, /sdCylinderZ/);
  });

  it("emits material weights for cube and sphere leaves", () => {
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
    assert.equal(result.liveParams.length, 0);
    assert.equal(result.liveCallSuffix, "");
  });

  it("emits live sphere center and radius as sampleField params", () => {
    const result = fieldNodeToWgsl(demoFieldNode(), {
      leafMaterialWeight: { "demo-cube": 0, "demo-sphere": 1 },
      liveSphereCenters: { "demo-sphere": "liveSphereCenter" },
      liveSphereRadii: { "demo-sphere": "liveSphereRadius" },
    });
    assert.match(
      result.mapSource,
      /fn sampleField\(p: vec3<f32>, liveSphereCenter: vec3<f32>, liveSphereRadius: f32, hlLeaf: f32\)/,
    );
    assert.match(
      result.mapSource,
      /sdSphere\(\(p\) - liveSphereCenter, liveSphereRadius\)/,
    );
    // Baked corner center must not appear for the live sphere.
    assert.doesNotMatch(
      result.mapSource,
      /sdSphere\(\(p\) - vec3<f32>\(100\.0, 100\.0, 100\.0\)/,
    );
    assert.equal(result.liveParams.length, 2);
    assert.equal(result.liveCallSuffix, ", liveSphereCenter, liveSphereRadius");
    assert.equal(
      result.liveDeclSuffix,
      ", liveSphereCenter: vec3<f32>, liveSphereRadius: f32",
    );
  });

  it("assigns stable leaf indices and mixes a highlight channel", () => {
    const result = fieldNodeToWgsl(demoFieldNode(), {
      leafMaterialWeight: { "demo-cube": 0, "demo-sphere": 1 },
    });
    assert.ok(result.leafIds.includes("demo-sphere"));
    assert.ok(result.leafIds.includes("demo-cube"));
    const sphereIdx = result.leafIds.indexOf("demo-sphere");
    assert.match(
      result.mapSource,
      new RegExp(`abs\\(hlLeaf - ${sphereIdx}\\.0\\) < 0\\.5`),
    );
    // Highlight membership is mixed through CSG like material weight.
    assert.match(result.mapSource, /let hl\d+ = max\(/);
    assert.match(result.mapSource, /return vec3<f32>\(/);
  });
});
