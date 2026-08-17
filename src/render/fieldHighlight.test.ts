import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  easeToward,
  HIGHLIGHT_AMOUNT,
  highlightCursor,
  highlightLevelFor,
} from "./fieldHighlight";
import { collectFieldLeafIds } from "./fieldToWgsl";
import { demoFieldNode } from "../document/demoDocument";

describe("highlightLevelFor", () => {
  it("is aware on hover with no buttons", () => {
    assert.equal(
      highlightLevelFor({
        hoverLeafId: "demo-sphere",
        phase: "idle",
        pointerButtons: 0,
      }),
      "aware",
    );
  });

  it("is rest while orbiting even if the ray still hits", () => {
    assert.equal(
      highlightLevelFor({
        hoverLeafId: "demo-sphere",
        phase: "idle",
        pointerButtons: 1,
      }),
      "rest",
    );
  });

  it("is engaged for pending and grabbing regardless of hover", () => {
    assert.equal(
      highlightLevelFor({
        hoverLeafId: null,
        phase: "pending",
        pointerButtons: 1,
      }),
      "engaged",
    );
    assert.equal(
      highlightLevelFor({
        hoverLeafId: "demo-sphere",
        phase: "grabbing",
        pointerButtons: 1,
      }),
      "engaged",
    );
  });

  it("is rest when idle and not over a leaf", () => {
    assert.equal(
      highlightLevelFor({
        hoverLeafId: null,
        phase: "idle",
        pointerButtons: 0,
      }),
      "rest",
    );
  });
});

describe("highlightCursor", () => {
  it("uses grab / grabbing, not a custom CAD cursor", () => {
    assert.equal(highlightCursor("aware", "idle"), "grab");
    assert.equal(highlightCursor("engaged", "pending"), "grab");
    assert.equal(highlightCursor("engaged", "grabbing"), "grabbing");
    assert.equal(highlightCursor("rest", "idle"), "");
  });
});

describe("easeToward", () => {
  it("reaches the target in one duration", () => {
    assert.equal(easeToward(0, 1, 140, 140), 1);
  });

  it("moves linearly so hold and wake share a beat", () => {
    assert.ok(Math.abs(easeToward(0, 1, 70, 140) - 0.5) < 1e-9);
  });

  it("snaps when close", () => {
    assert.equal(easeToward(0.999, 1, 1, 140), 1);
  });
});

describe("HIGHLIGHT_AMOUNT", () => {
  it("is a 0..1 wake, not a material slot poke", () => {
    assert.equal(HIGHLIGHT_AMOUNT.rest, 0);
    assert.ok(HIGHLIGHT_AMOUNT.aware > HIGHLIGHT_AMOUNT.rest);
    assert.ok(HIGHLIGHT_AMOUNT.engaged >= HIGHLIGHT_AMOUNT.aware);
    assert.ok(HIGHLIGHT_AMOUNT.engaged <= 1);
  });
});

describe("collectFieldLeafIds", () => {
  it("lists every named body in the demo tree", () => {
    const ids = collectFieldLeafIds(demoFieldNode());
    assert.ok(ids.includes("demo-sphere"));
    assert.ok(ids.includes("demo-cube"));
    assert.ok(ids.includes("cut-cube"));
    assert.deepEqual(ids, [...ids].sort());
  });
});
