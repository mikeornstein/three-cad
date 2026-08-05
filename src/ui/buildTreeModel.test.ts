import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoPartDef } from "../document/demoDocument";
import {
  buildTreeSummary,
  fieldNodeToBuildTree,
  partToBuildTree,
} from "./buildTreeModel";

describe("partToBuildTree / fieldNodeToBuildTree", () => {
  it("builds the demo cube ∪ sphere tree with leaf ids and params", () => {
    const root = partToBuildTree(demoPartDef());
    assert.equal(root.op, "part");
    assert.equal(root.path, "part");
    assert.match(root.title, /Demo|demo-body/i);
    assert.ok(root.detail?.includes("generic"));
    assert.ok(root.detail?.includes("demo-body"));
    assert.equal(root.children?.length, 1);

    const join = root.children![0]!;
    assert.equal(join.op, "smoothUnion");
    assert.equal(join.leafId, "demo-union");
    assert.equal(join.path, "part/field");
    assert.equal(join.children?.length, 2);
    assert.match(join.detail ?? "", /k=/);

    const box = join.children![0]!;
    const sphere = join.children![1]!;
    assert.equal(box.op, "box");
    assert.equal(box.leafId, "demo-cube");
    assert.equal(box.path, "part/field/a");
    assert.ok(box.detail?.includes("100×100×100"));
    assert.equal(sphere.op, "sphere");
    assert.equal(sphere.leafId, "demo-sphere");
    assert.equal(sphere.path, "part/field/b");
    assert.ok(sphere.detail?.includes("r=50"));
  });

  it("summarizes a node for clipboard", () => {
    const box = fieldNodeToBuildTree(
      {
        op: "box",
        min: [0, 0, 0],
        max: [10, 20, 30],
        leafId: "block",
      },
      "x",
    );
    const s = buildTreeSummary(box);
    assert.ok(s.includes("box"));
    assert.ok(s.includes("leaf:block"));
    assert.ok(s.includes("10×20×30"));
  });
});
