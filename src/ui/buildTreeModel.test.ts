import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoPartDef } from "../document/demoDocument";
import {
  buildTreeSummary,
  fieldNodeToBuildTree,
  partToBuildTree,
} from "./buildTreeModel";

describe("partToBuildTree / fieldNodeToBuildTree", () => {
  it("builds the demo cut-cube then soft-union sphere tree", () => {
    const root = partToBuildTree(demoPartDef());
    assert.equal(root.op, "part");
    assert.equal(root.path, "part");
    assert.match(root.title, /Demo|demo-body/i);
    assert.ok(root.detail?.includes("generic"));
    assert.ok(root.detail?.includes("demo-body"));
    assert.equal(root.children?.length, 1);

    // Root: smoothUnion(cut-cube, sphere) — no re-cut
    const join = root.children![0]!;
    assert.equal(join.op, "smoothUnion");
    assert.equal(join.leafId, "demo-union");
    assert.equal(join.path, "part/field");
    assert.equal(join.children?.length, 2);
    assert.match(join.detail ?? "", /k=/);

    const cutCube = join.children![0]!;
    const sphere = join.children![1]!;
    assert.equal(cutCube.op, "difference");
    assert.equal(cutCube.leafId, "cut-cube");
    assert.equal(cutCube.children?.length, 2);

    const box = cutCube.children![0]!;
    const unionedCyls = cutCube.children![1]!;
    assert.equal(box.op, "box");
    assert.equal(box.leafId, "demo-cube");
    assert.ok(box.detail?.includes("100×100×100"));
    assert.equal(unionedCyls.op, "smoothUnion");
    assert.equal(unionedCyls.leafId, "unioned-cyls");

    assert.equal(sphere.op, "sphere");
    assert.equal(sphere.leafId, "demo-sphere");
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
