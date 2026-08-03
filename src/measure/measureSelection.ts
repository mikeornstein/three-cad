/**
 * Build a MeasureReport from the current selection + topology index.
 */

import { Vector3 } from "three";
import { measurePlanarFaceFromField } from "../sdf/fieldMeasure";
import type {
  SolidTopology,
  TopologyFace,
  TopologyIndex,
} from "../selection/topology";
import type { SelectionKind, SelectionRef } from "../selection/types";
import {
  formatDeg,
  formatDelta,
  formatDir,
  formatMm,
  formatMm2,
  formatMm3,
  formatVec3,
} from "./format";
import {
  areNormalsParallel,
  edgeDirection,
  edgeIsLinear,
  faceTriangleSoup,
  isPlanarSoup,
  meshVolumeCentroid,
  planeAngleDeg,
  planeSignedDistance,
  pointSegmentDistanceSq,
  pointTriangleDistanceSq,
  polylineLength,
  polylinePairDistance,
  polylinePointAt,
  solidTriangleSoup,
  soupAabb,
  soupAverageNormal,
  soupCentroidAreaWeighted,
  soupMaxVertexDistance,
  soupMinDistance,
  soupVertices,
  triangleAreaSum,
  type TriangleSoup,
} from "./meshMath";
import type { MeasureField, MeasureReport } from "./types";

export function measureSelection(
  refs: readonly SelectionRef[],
  topology: TopologyIndex | null,
): MeasureReport {
  if (refs.length === 0 || !topology) {
    return {
      title: "No selection",
      fields: [{ label: "Hint", value: "Click geometry to measure" }],
      empty: true,
    };
  }

  const kinds = new Set(refs.map((r) => r.kind));
  if (kinds.size === 1) {
    const kind = refs[0]!.kind;
    if (refs.length === 1) return measureSingle(refs[0]!, topology);
    return measureMultiSameKind(kind, refs, topology);
  }

  return measureMixed(refs, topology);
}

function measureSingle(
  ref: SelectionRef,
  topology: TopologyIndex,
): MeasureReport {
  const entry = topology.byEntityId.get(ref.id);
  if (!entry) {
    return {
      title: ref.id,
      fields: [{ label: "Status", value: "entity not in topology" }],
      empty: false,
    };
  }
  const { solid, kind, localIndex } = entry;

  if (kind === "vertex") {
    const v = solid.vertices[localIndex]!;
    const fields: MeasureField[] = [
      field("Position", formatVec3(v.position)),
    ];
    if (v.exact) fields.push(field("Geometry", "exact (field source)"));
    return {
      title: `Vertex · ${ref.id}`,
      fields,
      empty: false,
    };
  }

  if (kind === "edge") {
    const e = solid.edges[localIndex]!;
    // Prefer exact constructive length when present (field source).
    const length =
      e.length !== undefined ? e.length : polylineLength(e.points);
    const mid = polylinePointAt(e.points, 0.5);
    const fields: MeasureField[] = [
      field("Length", formatMm(length), length),
      field("Midpoint", formatVec3(mid)),
      field("Ends", `${formatVec3(e.a)} → ${formatVec3(e.b)}`),
    ];
    if (e.exact) fields.push(field("Geometry", "exact (field source)"));
    return {
      title: `Edge · ${ref.id}`,
      fields,
      empty: false,
    };
  }

  if (kind === "face") {
    const face = solid.faces[localIndex]!;
    const soup = faceTriangleSoup(solid, face);
    const meshArea = triangleAreaSum(soup);
    const meshCentroid = soupCentroidAreaWeighted(soup);
    const meshNormal = soupAverageNormal(soup);
    const box = soupAabb(soup);
    const size = box.getSize(new Vector3());
    const planar = isPlanarSoup(soup, meshNormal, meshCentroid);

    // Prefer field-based planar measure (mesh is only a seed / fallback).
    const fieldMetric = refineFaceFromField(solid, face, meshCentroid, meshNormal);

    const area = fieldMetric?.area ?? face.area ?? meshArea;
    const centroid = fieldMetric
      ? new Vector3(
          fieldMetric.centroid[0],
          fieldMetric.centroid[1],
          fieldMetric.centroid[2],
        )
      : meshCentroid;
    const normal = fieldMetric
      ? new Vector3(
          fieldMetric.normal[0],
          fieldMetric.normal[1],
          fieldMetric.normal[2],
        )
      : meshNormal;

    const fields: MeasureField[] = [
      field("Area", formatMm2(area), area),
      field("Centroid", formatVec3(centroid)),
      field("Extents", formatDelta(size)),
      field("AABB", `${formatVec3(box.min)} … ${formatVec3(box.max)}`),
    ];
    if (fieldMetric?.rectangular && fieldMetric.width !== undefined) {
      fields.push(
        field(
          "Size",
          `${formatMm(fieldMetric.width)} × ${formatMm(fieldMetric.height!)}`,
        ),
      );
    }
    if (face.leafId) {
      fields.push(field("Field leaf", face.leafId));
    }
    if (fieldMetric) {
      fields.push(field("Geometry", "field measure"));
    }
    if (planar || fieldMetric?.rectangular) {
      fields.push(field("Normal", formatDir(normal)));
      fields.push(field("Planar", "yes"));
    } else {
      fields.push(field("Planar", "no (curved / faceted region)"));
    }
    return { title: `Face · ${ref.id}`, fields, empty: false };
  }

  const soup = solidTriangleSoup(solid);
  const { volume, centroid } = meshVolumeCentroid(soup);
  const fields: MeasureField[] = [
    field("Volume", formatMm3(volume), volume),
    field("Centroid", formatVec3(centroid)),
  ];
  if (solid.field) {
    fields.push(field("Solid rep", "SDF field (+ mesh derivative)"));
    const leaves = new Set(
      solid.faces.map((f) => f.leafId).filter((id): id is string => !!id),
    );
    if (leaves.size > 0) {
      fields.push(field("CSG leaves", [...leaves].join(", ")));
    }
  }
  return {
    title: `Solid · ${ref.id}`,
    fields,
    empty: false,
  };
}

function measureMultiSameKind(
  kind: SelectionKind,
  refs: readonly SelectionRef[],
  topology: TopologyIndex,
): MeasureReport {
  if (kind === "vertex") return measureVertices(refs, topology);
  if (kind === "edge") return measureEdges(refs, topology);
  if (kind === "face") return measureFaces(refs, topology);
  return measureSolids(refs, topology);
}

function measureVertices(
  refs: readonly SelectionRef[],
  topology: TopologyIndex,
): MeasureReport {
  const pts: Vector3[] = [];
  for (const ref of refs) {
    const e = topology.byEntityId.get(ref.id);
    if (!e || e.kind !== "vertex") continue;
    pts.push(e.solid.vertices[e.localIndex]!.position.clone());
  }
  const fields: MeasureField[] = [field("Count", String(pts.length))];
  if (pts.length === 2) {
    const d = pts[0]!.distanceTo(pts[1]!);
    fields.push(field("Distance", formatMm(d), d));
    fields.push(field("A", formatVec3(pts[0]!)));
    fields.push(field("B", formatVec3(pts[1]!)));
  } else if (pts.length > 2) {
    let min = Infinity;
    let max = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = pts[i]!.distanceTo(pts[j]!);
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
    }
    fields.push(field("Min distance", formatMm(min), min));
    fields.push(field("Max distance", formatMm(max), max));
  }
  return {
    title: `Vertices · ${refs.length} selected`,
    fields,
    empty: false,
  };
}

function measureEdges(
  refs: readonly SelectionRef[],
  topology: TopologyIndex,
): MeasureReport {
  const edges = [];
  for (const ref of refs) {
    const e = topology.byEntityId.get(ref.id);
    if (!e || e.kind !== "edge") continue;
    edges.push(e.solid.edges[e.localIndex]!);
  }
  let totalLen = 0;
  for (const ed of edges) {
    totalLen += ed.length !== undefined ? ed.length : polylineLength(ed.points);
  }

  const fields: MeasureField[] = [
    field("Count", String(edges.length)),
    field("Combined length", formatMm(totalLen), totalLen),
  ];

  if (edges.length === 2) {
    const a = edges[0]!;
    const b = edges[1]!;
    const { min, maxEndpoint } = polylinePairDistance(a.points, b.points);
    fields.push(field("Min distance", formatMm(min), min));
    fields.push(field("Max endpoint span", formatMm(maxEndpoint), maxEndpoint));
    fields.push(field("Mid A", formatVec3(polylinePointAt(a.points, 0.5))));
    fields.push(field("Mid B", formatVec3(polylinePointAt(b.points, 0.5))));
    if (edgeIsLinear(a) && edgeIsLinear(b)) {
      const ang = planeAngleDeg(edgeDirection(a), edgeDirection(b));
      fields.push(field("Angle (directions)", formatDeg(ang), ang));
    }
  } else if (edges.length > 2) {
    let min = Infinity;
    let maxSpan = 0;
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const { min: d, maxEndpoint } = polylinePairDistance(
          edges[i]!.points,
          edges[j]!.points,
        );
        min = Math.min(min, d);
        maxSpan = Math.max(maxSpan, maxEndpoint);
      }
    }
    if (Number.isFinite(min)) {
      fields.push(field("Min pairwise dist", formatMm(min), min));
    }
    fields.push(field("Max endpoint span", formatMm(maxSpan), maxSpan));
  }

  return {
    title: `Edges · ${refs.length} selected`,
    fields,
    empty: false,
  };
}

function measureFaces(
  refs: readonly SelectionRef[],
  topology: TopologyIndex,
): MeasureReport {
  type FacePack = {
    soup: TriangleSoup;
    area: number;
    centroid: Vector3;
    normal: Vector3;
    planar: boolean;
  };
  const faces: FacePack[] = [];
  for (const ref of refs) {
    const e = topology.byEntityId.get(ref.id);
    if (!e || e.kind !== "face") continue;
    const face = e.solid.faces[e.localIndex]!;
    const soup = faceTriangleSoup(e.solid, face);
    const normal = soupAverageNormal(soup);
    const centroid = soupCentroidAreaWeighted(soup);
    faces.push({
      soup,
      area: triangleAreaSum(soup),
      centroid,
      normal,
      planar: isPlanarSoup(soup, normal, centroid),
    });
  }

  const totalArea = faces.reduce((s, f) => s + f.area, 0);
  const fields: MeasureField[] = [
    field("Count", String(faces.length)),
    field("Combined area", formatMm2(totalArea), totalArea),
  ];

  if (faces.length === 2) {
    const a = faces[0]!;
    const b = faces[1]!;
    const minD = soupMinDistance(a.soup, b.soup);
    const maxD = soupMaxVertexDistance(a.soup, b.soup);
    fields.push(field("Min distance", formatMm(minD), minD));
    fields.push(field("Max vertex span", formatMm(maxD), maxD));

    if (a.planar && b.planar) {
      if (areNormalsParallel(a.normal, b.normal)) {
        const dists: number[] = [];
        for (const v of soupVertices(a.soup)) {
          dists.push(Math.abs(planeSignedDistance(v, b.centroid, b.normal)));
        }
        for (const v of soupVertices(b.soup)) {
          dists.push(Math.abs(planeSignedDistance(v, a.centroid, a.normal)));
        }
        const minP = Math.min(...dists);
        const maxP = Math.max(...dists);
        fields.push(field("Parallel", "yes"));
        fields.push(field("Perp. min", formatMm(minP), minP));
        fields.push(field("Perp. max", formatMm(maxP), maxP));
      } else {
        const ang = planeAngleDeg(a.normal, b.normal);
        fields.push(field("Parallel", "no"));
        fields.push(field("Plane angle", formatDeg(ang), ang));
      }
    } else {
      fields.push(field("Planar pair", "no — skip plane angle / perp."));
    }
  } else if (faces.length > 2) {
    let min = Infinity;
    let maxSpan = 0;
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        min = Math.min(min, soupMinDistance(faces[i]!.soup, faces[j]!.soup));
        maxSpan = Math.max(
          maxSpan,
          soupMaxVertexDistance(faces[i]!.soup, faces[j]!.soup),
        );
      }
    }
    if (Number.isFinite(min)) {
      fields.push(field("Min pairwise dist", formatMm(min), min));
    }
    fields.push(field("Max vertex span", formatMm(maxSpan), maxSpan));
  }

  return {
    title: `Faces · ${refs.length} selected`,
    fields,
    empty: false,
  };
}

function measureSolids(
  refs: readonly SelectionRef[],
  topology: TopologyIndex,
): MeasureReport {
  const packs: { id: string; soup: TriangleSoup; volume: number; centroid: Vector3 }[] =
    [];
  for (const ref of refs) {
    const e = topology.byEntityId.get(ref.id);
    if (!e || e.kind !== "solid") continue;
    const soup = solidTriangleSoup(e.solid);
    const vc = meshVolumeCentroid(soup);
    packs.push({ id: ref.id, soup, ...vc });
  }
  const totalVol = packs.reduce((s, p) => s + p.volume, 0);
  const fields: MeasureField[] = [
    field("Count", String(packs.length)),
    field("Combined volume", formatMm3(totalVol), totalVol),
  ];
  if (packs.length === 2) {
    fields.push(field("Centroid A", formatVec3(packs[0]!.centroid)));
    fields.push(field("Centroid B", formatVec3(packs[1]!.centroid)));
    const minD = soupMinDistance(packs[0]!.soup, packs[1]!.soup);
    fields.push(field("Min distance", formatMm(minD), minD));
  } else {
    for (const p of packs) {
      fields.push(field(`Centroid ${shortId(p.id)}`, formatVec3(p.centroid)));
    }
  }
  return {
    title: `Solids · ${refs.length} selected`,
    fields,
    empty: false,
  };
}

function measureMixed(
  refs: readonly SelectionRef[],
  topology: TopologyIndex,
): MeasureReport {
  const counts: Record<SelectionKind, number> = {
    solid: 0,
    face: 0,
    edge: 0,
    vertex: 0,
  };
  for (const r of refs) counts[r.kind]++;

  const parts: string[] = [];
  if (counts.solid) parts.push(`${counts.solid} solid`);
  if (counts.face) parts.push(`${counts.face} face`);
  if (counts.edge) parts.push(`${counts.edge} edge`);
  if (counts.vertex) parts.push(`${counts.vertex} vertex`);

  const fields: MeasureField[] = [
    field("Selection", parts.join(", ")),
    field("Total", String(refs.length)),
  ];

  if (refs.length === 2) {
    fields.push(...pairMetric(refs[0]!, refs[1]!, topology));
  } else {
    fields.push(
      field(
        "Note",
        "Mixed multi-select — pair metrics only for exactly two items",
      ),
    );
  }

  return {
    title: `Mixed · ${refs.length} selected`,
    fields,
    empty: false,
  };
}

function pairMetric(
  a: SelectionRef,
  b: SelectionRef,
  topology: TopologyIndex,
): MeasureField[] {
  if (a.kind === "vertex" && b.kind === "vertex") {
    const pa = pointOf(a, topology);
    const pb = pointOf(b, topology);
    if (pa && pb) {
      const d = pa.distanceTo(pb);
      return [field("Distance", formatMm(d), d)];
    }
  }

  if (a.kind === "vertex" || b.kind === "vertex") {
    const vRef = a.kind === "vertex" ? a : b;
    const other = a.kind === "vertex" ? b : a;
    const vp = pointOf(vRef, topology);
    if (vp) {
      const d = distancePointToEntity(vp, other, topology);
      if (d !== null) return [field("Distance", formatMm(d), d)];
    }
  }

  if (a.kind === "edge" && b.kind === "edge") {
    return measureEdges([a, b], topology).fields.filter(
      (f) =>
        f.label === "Min distance" ||
        f.label === "Angle (directions)" ||
        f.label === "Combined length",
    );
  }

  if (a.kind === "face" && b.kind === "face") {
    return measureFaces([a, b], topology).fields.filter(
      (f) =>
        f.label !== "Count" &&
        f.label !== "Combined area",
    );
  }

  const d2 = entityEntityMinDistance(a, b, topology);
  if (d2 !== null) return [field("Min distance", formatMm(d2), d2)];

  return [field("Pair", `${a.kind} + ${b.kind} — no pair metric`)];
}

function pointOf(
  ref: SelectionRef,
  topology: TopologyIndex,
): Vector3 | null {
  const e = topology.byEntityId.get(ref.id);
  if (!e) return null;
  if (e.kind === "vertex") {
    return e.solid.vertices[e.localIndex]!.position.clone();
  }
  if (e.kind === "edge") {
    return polylinePointAt(e.solid.edges[e.localIndex]!.points, 0.5);
  }
  if (e.kind === "face") {
    return e.solid.faces[e.localIndex]!.centroid.clone();
  }
  return meshVolumeCentroid(solidTriangleSoup(e.solid)).centroid;
}

function distancePointToEntity(
  p: Vector3,
  ref: SelectionRef,
  topology: TopologyIndex,
): number | null {
  const e = topology.byEntityId.get(ref.id);
  if (!e) return null;

  if (e.kind === "vertex") {
    return p.distanceTo(e.solid.vertices[e.localIndex]!.position);
  }

  if (e.kind === "edge") {
    const pts = e.solid.edges[e.localIndex]!.points;
    let min = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      min = Math.min(
        min,
        Math.sqrt(pointSegmentDistanceSq(p, pts[i]!, pts[i + 1]!)),
      );
    }
    return Number.isFinite(min) ? min : null;
  }

  const soup =
    e.kind === "face"
      ? faceTriangleSoup(e.solid, e.solid.faces[e.localIndex]!)
      : solidTriangleSoup(e.solid);
  return pointToSoupMin(p, soup);
}

function pointToSoupMin(p: Vector3, soup: TriangleSoup): number {
  const pos = soup.positions;
  let min = Infinity;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < soup.triCount; t++) {
    const o = t * 9;
    a.set(pos[o]!, pos[o + 1]!, pos[o + 2]!);
    b.set(pos[o + 3]!, pos[o + 4]!, pos[o + 5]!);
    c.set(pos[o + 6]!, pos[o + 7]!, pos[o + 8]!);
    min = Math.min(min, Math.sqrt(pointTriangleDistanceSq(p, a, b, c)));
  }
  return Number.isFinite(min) ? min : 0;
}

function entityEntityMinDistance(
  a: SelectionRef,
  b: SelectionRef,
  topology: TopologyIndex,
): number | null {
  const ea = topology.byEntityId.get(a.id);
  const eb = topology.byEntityId.get(b.id);
  if (!ea || !eb) return null;

  if (ea.kind === "edge" && eb.kind === "edge") {
    return polylinePairDistance(
      ea.solid.edges[ea.localIndex]!.points,
      eb.solid.edges[eb.localIndex]!.points,
    ).min;
  }

  if (ea.kind === "edge" || eb.kind === "edge") {
    const edgeEntry = ea.kind === "edge" ? ea : eb;
    const otherRef = ea.kind === "edge" ? b : a;
    const pts = edgeEntry.solid.edges[edgeEntry.localIndex]!.points;
    let min = Infinity;
    for (const p of pts) {
      const d = distancePointToEntity(p, otherRef, topology);
      if (d !== null) min = Math.min(min, d);
    }
    // Also sample other entity toward edge
    const otherPt = pointOf(otherRef, topology);
    if (otherPt) {
      for (let i = 0; i < pts.length - 1; i++) {
        min = Math.min(
          min,
          Math.sqrt(pointSegmentDistanceSq(otherPt, pts[i]!, pts[i + 1]!)),
        );
      }
    }
    return Number.isFinite(min) ? min : null;
  }

  const sa = entitySoup(a, topology);
  const sb = entitySoup(b, topology);
  if (sa && sb) return soupMinDistance(sa, sb);
  return null;
}

function entitySoup(
  ref: SelectionRef,
  topology: TopologyIndex,
): TriangleSoup | null {
  const e = topology.byEntityId.get(ref.id);
  if (!e) return null;
  if (e.kind === "face") {
    return faceTriangleSoup(e.solid, e.solid.faces[e.localIndex]!);
  }
  if (e.kind === "solid") {
    return solidTriangleSoup(e.solid);
  }
  return null;
}

function shortId(id: string): string {
  const slash = id.lastIndexOf("/");
  if (slash >= 0) return id.slice(slash + 1);
  const colon = id.indexOf(":");
  return colon >= 0 ? id.slice(colon + 1) : id;
}

function field(label: string, value: string, numeric?: number): MeasureField {
  return numeric === undefined ? { label, value } : { label, value, numeric };
}

/**
 * Refine face area / frame from the field solid when available.
 * Mutates face.area / exact for reuse.
 */
function refineFaceFromField(
  solid: SolidTopology,
  face: TopologyFace,
  meshCentroid: Vector3,
  meshNormal: Vector3,
): ReturnType<typeof measurePlanarFaceFromField> {
  if (face.exact && face.area !== undefined) {
    return {
      area: face.area,
      normal: [face.normal.x, face.normal.y, face.normal.z],
      centroid: [face.centroid.x, face.centroid.y, face.centroid.z],
      rectangular: true,
    };
  }
  if (!solid.field) return null;

  // Curved patches (sphere, freeform): keep mesh area — planar field measure
  // does not apply.
  const ax = Math.abs(meshNormal.x);
  const ay = Math.abs(meshNormal.y);
  const az = Math.abs(meshNormal.z);
  if (Math.max(ax, ay, az) < 0.9) return null;

  const metric = measurePlanarFaceFromField(
    solid.field,
    [meshCentroid.x, meshCentroid.y, meshCentroid.z],
    {
      leafId: face.leafId,
      normalHint: [meshNormal.x, meshNormal.y, meshNormal.z],
    },
  );
  if (!metric) return null;

  face.area = metric.area;
  face.exact = true;
  face.centroid.set(
    metric.centroid[0],
    metric.centroid[1],
    metric.centroid[2],
  );
  face.normal.set(metric.normal[0], metric.normal[1], metric.normal[2]);
  return metric;
}

/** Ensure field face metrics are attached (for tests / batch). */
export function attachFieldFaceMetrics(solid: SolidTopology): void {
  if (!solid.field) return;
  for (const face of solid.faces) {
    if (face.exact && face.area !== undefined) continue;
    refineFaceFromField(solid, face, face.centroid, face.normal);
  }
}
