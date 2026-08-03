import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  definitionHash,
  hashString,
  meshCacheKey,
  stableStringify,
} from "./hash";
import { demoPartDef } from "./demoDocument";
import { FIELD_TREE_GENERATOR_VERSION } from "./fieldDef";

describe("stableStringify", () => {
  it("sorts object keys", () => {
    assert.equal(
      stableStringify({ b: 1, a: 2 }),
      stableStringify({ a: 2, b: 1 }),
    );
    assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it("normalizes -0", () => {
    assert.equal(stableStringify(-0), "0");
  });
});

describe("definitionHash", () => {
  it("is stable for the demo part payload", () => {
    const a = demoPartDef();
    const b = demoPartDef();
    const ha = definitionHash({
      kind: a.kind,
      generator: a.generator,
      payload: a.payload,
    });
    const hb = definitionHash({
      kind: b.kind,
      generator: b.generator,
      payload: b.payload,
    });
    assert.equal(ha, hb);
    assert.match(ha, /^def:[0-9a-f]{16}$/);
  });

  it("ignores part id (geometry identity only)", () => {
    const base = demoPartDef();
    const renamed = { ...base, id: "other-id" };
    assert.equal(
      definitionHash({
        kind: base.kind,
        generator: base.generator,
        payload: base.payload,
      }),
      definitionHash({
        kind: renamed.kind,
        generator: renamed.generator,
        payload: renamed.payload,
      }),
    );
  });

  it("changes when generator version changes", () => {
    const part = demoPartDef();
    const h1 = definitionHash({
      kind: part.kind,
      generator: part.generator,
      payload: part.payload,
    });
    const h2 = definitionHash({
      kind: part.kind,
      generator: {
        name: "fieldTree",
        version: FIELD_TREE_GENERATOR_VERSION + 1,
      },
      payload: part.payload,
    });
    assert.notEqual(h1, h2);
  });

  it("hashString is deterministic", () => {
    assert.equal(hashString("hello"), hashString("hello"));
    assert.notEqual(hashString("hello"), hashString("world"));
  });
});

describe("meshCacheKey", () => {
  it("includes cell size and pad", () => {
    const k1 = meshCacheKey("def:abc", { cellSizeMm: 1.5 });
    const k2 = meshCacheKey("def:abc", { cellSizeMm: 1.5, padMm: 2 });
    const k3 = meshCacheKey("def:abc", { cellSizeMm: 0.5 });
    assert.notEqual(k1, k2);
    assert.notEqual(k1, k3);
    assert.equal(k1, meshCacheKey("def:abc", { cellSizeMm: 1.5 }));
  });
});
