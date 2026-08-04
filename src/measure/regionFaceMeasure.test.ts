/**
 * Measure bar path for field surface-region faces (no triangle soup).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Mesh, Vector3 } from "three";
import { demoHardUnionFieldNode } from "../document/demoDocument";
import { buildField } from "../eval/buildField";
import { densifyRegionForHighlight, growSurfaceRegion } from "../sdf/fieldRegion";
import { measureSelection } from "./measureSelection";
import type { SolidTopology, TopologyIndex } from "../selection/topology";
import { makeEntityId, makeSolidEntityId } from "../selection/types";

function regionTopology(
  field: ReturnType<typeof buildField>,
  seed: [number, number, number],
): { topology: TopologyIndex; faceId: string } {
  const region = growSurfaceRegion(field, seed);
  assert.ok(region);
  const dense = densifyRegionForHighlight(field, region!);
  const solidId = "demo";
  const localId = region!.regionKey;
  const faceId = makeEntityId("face", solidId, localId);
  const solid: SolidTopology = {
    solidId,
    solidEntityId: makeSolidEntityId(solidId),
    mesh: new Mesh(),
    field,
    faces: [
      {
        localId,
        id: faceId,
        leafId: region!.leafId,
        triangleIndices: [],
        centroid: new Vector3(
          region!.centroid[0],
          region!.centroid[1],
          region!.centroid[2],
        ),
        normal: new Vector3(
          region!.meanNormal[0],
          region!.meanNormal[1],
          region!.meanNormal[2],
        ),
        regionSamples: dense.positions,
        regionNormals: dense.normals,
        regionSeed: new Vector3(
          region!.seed[0],
          region!.seed[1],
          region!.seed[2],
        ),
        regionPlanar: region!.planar,
        regionPlane: region!.planeFrame
          ? {
              width: region!.planeFrame.width,
              height: region!.planeFrame.height,
              centroid: new Vector3(
                region!.planeFrame.centroid[0],
                region!.planeFrame.centroid[1],
                region!.planeFrame.centroid[2],
              ),
              normal: new Vector3(
                region!.planeFrame.normal[0],
                region!.planeFrame.normal[1],
                region!.planeFrame.normal[2],
              ),
              rectangular: region!.planeFrame.rectangular,
            }
          : undefined,
      },
    ],
    edges: [],
    vertices: [],
    triToFace: new Int32Array(0),
    triLeaf: [],
    edgePositions: new Float32Array(0),
    segmentToEdge: new Int32Array(0),
    vertexPositions: new Float32Array(0),
    edgeByIndex: [],
    vertexByIndex: [],
  };
  const topology: TopologyIndex = {
    solids: [solid],
    byEntityId: new Map([
      [faceId, { solid, kind: "face", localIndex: 0 }],
      [solid.solidEntityId, { solid, kind: "solid", localIndex: 0 }],
    ]),
  };
  return { topology, faceId };
}

describe("measureSelection: field region faces", () => {
  // Analytic cut-face areas assume hard min-union (product demo is smoothUnion).
  const field = buildField(demoHardUnionFieldNode());
  const cutExpect = 10_000 - (Math.PI * 50 * 50) / 4;

  it("reports planar cube face area from field (no mesh soup)", () => {
    const { topology, faceId } = regionTopology(field, [0, 50, 50]);
    const report = measureSelection(
      [{ kind: "face", id: faceId, solidId: "demo" }],
      topology,
    );
    assert.equal(report.empty, false);
    const area = report.fields.find((f) => f.label === "Area");
    assert.ok(area?.numeric !== undefined);
    assert.ok(
      Math.abs(area!.numeric! - 10_000) < 50,
      `area=${area!.numeric}`,
    );
    assert.ok(
      report.fields.some(
        (f) => f.label === "Geometry" && f.value.includes("field"),
      ),
    );
    assert.ok(
      report.fields.some((f) => f.label === "Planar" && f.value === "yes"),
    );
  });

  it("cut +x planar face area is not the uncut AABB", () => {
    const { topology, faceId } = regionTopology(field, [100, 40, 40]);
    const report = measureSelection(
      [{ kind: "face", id: faceId, solidId: "demo" }],
      topology,
    );
    const area = report.fields.find((f) => f.label === "Area");
    assert.ok(area?.numeric !== undefined);
    assert.ok(
      Math.abs(area!.numeric! - cutExpect) < 1,
      `+x area=${area!.numeric} expect ${cutExpect}`,
    );
    assert.ok(Math.abs(area!.numeric! - 10_000) > 100, "must not be bbox 10000");
  });

  it("reports curved sphere region with positive field area", () => {
    const { topology, faceId } = regionTopology(field, [150, 100, 100]);
    const report = measureSelection(
      [{ kind: "face", id: faceId, solidId: "demo" }],
      topology,
    );
    assert.equal(report.empty, false);
    assert.ok(
      report.fields.some(
        (f) => f.label === "Planar" && f.value.includes("curved"),
      ),
    );
    assert.ok(report.fields.some((f) => f.label === "Field leaf"));
    const area = report.fields.find((f) => f.label === "Area");
    assert.ok(area?.numeric !== undefined, "curved faces must report Area");
    assert.ok(area!.numeric! > 10_000, `sphere area ${area!.numeric}`);
    // ~7/8 of 4πr² ≈ 27489
    assert.ok(
      Math.abs(area!.numeric! - 4 * Math.PI * 50 * 50 * (7 / 8)) < 400,
      `sphere area ${area!.numeric}`,
    );
  });
});
