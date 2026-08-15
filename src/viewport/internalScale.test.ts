import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTERNAL_SCALE_HIGH,
  INTERNAL_SCALE_LOW,
  INTERNAL_SCALE_MID,
  internalScaleFromFps,
} from "./internalScale";

describe("internalScaleFromFps", () => {
  it("drops to low when FPS is cold", () => {
    assert.equal(internalScaleFromFps(20, INTERNAL_SCALE_HIGH), INTERNAL_SCALE_LOW);
  });

  it("holds mid until FPS is clearly healthy", () => {
    assert.equal(internalScaleFromFps(40, INTERNAL_SCALE_MID), INTERNAL_SCALE_MID);
    assert.equal(internalScaleFromFps(50, INTERNAL_SCALE_MID), INTERNAL_SCALE_HIGH);
  });

  it("does not jump high→low across the mid band without hysteresis", () => {
    assert.equal(internalScaleFromFps(30, INTERNAL_SCALE_HIGH), INTERNAL_SCALE_MID);
    assert.equal(internalScaleFromFps(30, INTERNAL_SCALE_MID), INTERNAL_SCALE_LOW);
  });
});
