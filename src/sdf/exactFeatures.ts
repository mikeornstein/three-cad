/**
 * Exact sharp features (vertices + edges) from field constructive source.
 * Independent of mesh tessellation — lengths/positions to floating-point precision.
 */

import type { FieldSolid, Vec3 } from "./types";

export interface ExactVertex {
  readonly position: Vec3;
}

export type ExactEdge =
  | {
      kind: "line";
      a: Vec3;
      b: Vec3;
      /** Exact Euclidean length (mm). */
      length: number;
    }
  | {
      kind: "arc";
      /** Arc endpoints on a circle. */
      a: Vec3;
      b: Vec3;
      center: Vec3;
      radius: number;
      /** Exact arc length (mm), shorter arc unless angle ≥ π. */
      length: number;
      /** Included angle in radians (0, π]. */
      angle: number;
    };

export interface ExactFeatureSet {
  readonly vertices: ExactVertex[];
  readonly edges: ExactEdge[];
}

const ON_SURFACE = 1e-9;
const OUTSIDE = -1e-9; // evaluate >= OUTSIDE means outside-or-on for keep tests

function v3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function addVertex(list: ExactVertex[], p: Vec3, tol = 1e-9): void {
  for (const v of list) {
    if (dist(v.position, p) <= tol) return;
  }
  list.push({ position: p });
}

function lineEdge(a: Vec3, b: Vec3): ExactEdge {
  return { kind: "line", a, b, length: dist(a, b) };
}

/** Box corners and 12 edges. */
function boxFeatures(min: Vec3, max: Vec3): ExactFeatureSet {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const corners: Vec3[] = [
    v3(x0, y0, z0),
    v3(x1, y0, z0),
    v3(x0, y1, z0),
    v3(x1, y1, z0),
    v3(x0, y0, z1),
    v3(x1, y0, z1),
    v3(x0, y1, z1),
    v3(x1, y1, z1),
  ];
  const vertices = corners.map((position) => ({ position }));
  const edges: ExactEdge[] = [
    // bottom z0
    lineEdge(v3(x0, y0, z0), v3(x1, y0, z0)),
    lineEdge(v3(x1, y0, z0), v3(x1, y1, z0)),
    lineEdge(v3(x1, y1, z0), v3(x0, y1, z0)),
    lineEdge(v3(x0, y1, z0), v3(x0, y0, z0)),
    // top z1
    lineEdge(v3(x0, y0, z1), v3(x1, y0, z1)),
    lineEdge(v3(x1, y0, z1), v3(x1, y1, z1)),
    lineEdge(v3(x1, y1, z1), v3(x0, y1, z1)),
    lineEdge(v3(x0, y1, z1), v3(x0, y0, z1)),
    // verticals
    lineEdge(v3(x0, y0, z0), v3(x0, y0, z1)),
    lineEdge(v3(x1, y0, z0), v3(x1, y0, z1)),
    lineEdge(v3(x1, y1, z0), v3(x1, y1, z1)),
    lineEdge(v3(x0, y1, z0), v3(x0, y1, z1)),
  ];
  return { vertices, edges };
}

/**
 * Clip a line segment to where `keep(p)` is true.
 * Transitions are bisected for micron-level endpoint accuracy.
 */
function clipLineToKeep(
  a: Vec3,
  b: Vec3,
  keep: (p: Vec3) => boolean,
  samples = 128,
): Array<{ a: Vec3; b: Vec3 }> {
  const at = (t: number): Vec3 =>
    v3(
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
      a[2] + t * (b[2] - a[2]),
    );

  const samplesT: { t: number; k: boolean }[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    samplesT.push({ t, k: keep(at(t)) });
  }

  // Insert refined crossing parameters.
  const ts: { t: number; k: boolean }[] = [];
  for (let i = 0; i < samplesT.length; i++) {
    ts.push(samplesT[i]!);
    if (i + 1 < samplesT.length && samplesT[i]!.k !== samplesT[i + 1]!.k) {
      let lo = samplesT[i]!.t;
      let hi = samplesT[i + 1]!.t;
      let loK = samplesT[i]!.k;
      for (let it = 0; it < 50; it++) {
        const mid = 0.5 * (lo + hi);
        const k = keep(at(mid));
        if (k === loK) lo = mid;
        else hi = mid;
      }
      const t = 0.5 * (lo + hi);
      ts.push({ t, k: keep(at(t)) });
    }
  }
  ts.sort((u, v) => u.t - v.t);

  const segs: Array<{ a: Vec3; b: Vec3 }> = [];
  let i = 0;
  while (i < ts.length) {
    while (i < ts.length && !ts[i]!.k) i++;
    if (i >= ts.length) break;
    const t0 = ts[i]!.t;
    while (i + 1 < ts.length && ts[i + 1]!.k) i++;
    const t1 = ts[i]!.t;
    if (t1 - t0 > 1e-15) segs.push({ a: at(t0), b: at(t1) });
    i++;
  }
  return segs;
}

function outsideOrOn(solid: FieldSolid, p: Vec3): boolean {
  return solid.evaluate(p[0], p[1], p[2]) >= OUTSIDE;
}

function onSurface(solid: FieldSolid, p: Vec3, tol = 1e-6): boolean {
  return Math.abs(solid.evaluate(p[0], p[1], p[2])) <= tol;
}

/**
 * Arc length on a circle from A to B (shorter arc by default).
 * Both A,B must lie on the circle (within tol).
 */
function circleArc(a: Vec3, b: Vec3, center: Vec3, radius: number): ExactEdge {
  const ua = v3(a[0] - center[0], a[1] - center[1], a[2] - center[2]);
  const ub = v3(b[0] - center[0], b[1] - center[1], b[2] - center[2]);
  const la = Math.hypot(ua[0], ua[1], ua[2]);
  const lb = Math.hypot(ub[0], ub[1], ub[2]);
  const na = v3(ua[0] / la, ua[1] / la, ua[2] / la);
  const nb = v3(ub[0] / lb, ub[1] / lb, ub[2] / lb);
  let cos = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
  cos = Math.min(1, Math.max(-1, cos));
  let angle = Math.acos(cos);
  // Prefer the arc that stays on the solid surface region — for cube∪sphere
  // face arcs are ≤ π/2; use angle as-is (≤π from acos).
  if (angle < 1e-15) angle = 0;
  return {
    kind: "arc",
    a,
    b,
    center,
    radius,
    angle,
    length: radius * angle,
  };
}

/**
 * Sphere ∩ axis-aligned box face → circular arcs on the face, outside other cuts
 * handled by keepAgainst.
 */
function sphereBoxFaceArcs(
  center: Vec3,
  radius: number,
  boxMin: Vec3,
  boxMax: Vec3,
  keepAgainst: FieldSolid | null,
): ExactEdge[] {
  const faces: Array<{
    axis: 0 | 1 | 2;
    value: number;
    u: 0 | 1 | 2;
    v: 0 | 1 | 2;
    u0: number;
    u1: number;
    v0: number;
    v1: number;
  }> = [
    {
      axis: 0,
      value: boxMin[0],
      u: 1,
      v: 2,
      u0: boxMin[1],
      u1: boxMax[1],
      v0: boxMin[2],
      v1: boxMax[2],
    },
    {
      axis: 0,
      value: boxMax[0],
      u: 1,
      v: 2,
      u0: boxMin[1],
      u1: boxMax[1],
      v0: boxMin[2],
      v1: boxMax[2],
    },
    {
      axis: 1,
      value: boxMin[1],
      u: 0,
      v: 2,
      u0: boxMin[0],
      u1: boxMax[0],
      v0: boxMin[2],
      v1: boxMax[2],
    },
    {
      axis: 1,
      value: boxMax[1],
      u: 0,
      v: 2,
      u0: boxMin[0],
      u1: boxMax[0],
      v0: boxMin[2],
      v1: boxMax[2],
    },
    {
      axis: 2,
      value: boxMin[2],
      u: 0,
      v: 1,
      u0: boxMin[0],
      u1: boxMax[0],
      v0: boxMin[1],
      v1: boxMax[1],
    },
    {
      axis: 2,
      value: boxMax[2],
      u: 0,
      v: 1,
      u0: boxMin[0],
      u1: boxMax[0],
      v0: boxMin[1],
      v1: boxMax[1],
    },
  ];

  const edges: ExactEdge[] = [];
  for (const f of faces) {
    const d = center[f.axis] - f.value;
    const r2 = radius * radius - d * d;
    if (r2 <= 1e-18) continue; // plane misses sphere
    const r = Math.sqrt(r2);
    // Circle center in 3D
    const cc = v3(center[0], center[1], center[2]);
    const cArr = [cc[0], cc[1], cc[2]] as [number, number, number];
    cArr[f.axis] = f.value;
    const circleCenter = v3(cArr[0], cArr[1], cArr[2]);

    // Find circle ∩ face rectangle boundary points, plus classify the arc inside the rectangle.
    // Sample angles and find continuous arcs inside the rectangle and keepAgainst.
    const inside = (p: Vec3): boolean => {
      if (Math.abs(p[f.axis] - f.value) > 1e-9) return false;
      const pu = p[f.u];
      const pv = p[f.v];
      if (pu < f.u0 - 1e-9 || pu > f.u1 + 1e-9) return false;
      if (pv < f.v0 - 1e-9 || pv > f.v1 + 1e-9) return false;
      if (keepAgainst && !outsideOrOn(keepAgainst, p)) return false;
      // Point must be on sphere (true by construction) and on/outside box (on face).
      return true;
    };

    // Basis in plane
    const eUArr = [0, 0, 0];
    const eVArr = [0, 0, 0];
    eUArr[f.u] = 1;
    eVArr[f.v] = 1;
    const eu = v3(eUArr[0], eUArr[1], eUArr[2]);
    const ev = v3(eVArr[0], eVArr[1], eVArr[2]);

    const n = 720;
    const flags: boolean[] = [];
    const pts: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * i) / n;
      const p = v3(
        circleCenter[0] + r * (Math.cos(th) * eu[0] + Math.sin(th) * ev[0]),
        circleCenter[1] + r * (Math.cos(th) * eu[1] + Math.sin(th) * ev[1]),
        circleCenter[2] + r * (Math.cos(th) * eu[2] + Math.sin(th) * ev[2]),
      );
      pts.push(p);
      flags.push(inside(p));
    }
    // Extract contiguous true runs
    let i = 0;
    while (i < n) {
      while (i < n && !flags[i]) i++;
      if (i >= n) break;
      const start = i;
      while (i < n && flags[i]) i++;
      const end = i - 1;
      // Refine endpoints toward boundary for accuracy
      const a = refineArcEnd(pts, flags, start, -1, n, inside);
      const b = refineArcEnd(pts, flags, end, 1, n, inside);
      if (dist(a, b) > 1e-9) {
        edges.push(circleArc(a, b, circleCenter, r));
      }
    }
  }
  return edges;
}

function refineArcEnd(
  pts: Vec3[],
  flags: boolean[],
  idx: number,
  dir: -1 | 1,
  n: number,
  inside: (p: Vec3) => boolean,
): Vec3 {
  // Binary search between idx and idx+dir for surface of region
  const i0 = idx;
  const i1 = (idx + dir + n) % n;
  if (flags[i0] === flags[i1]) return pts[i0]!;
  let lo = pts[i0]!;
  let hi = pts[i1]!;
  let loIn = flags[i0]!;
  for (let it = 0; it < 40; it++) {
    const mid = v3(
      0.5 * (lo[0] + hi[0]),
      0.5 * (lo[1] + hi[1]),
      0.5 * (lo[2] + hi[2]),
    );
    // Project mid back onto circle roughly by midpoint is fine for small step
    if (inside(mid) === loIn) lo = mid;
    else hi = mid;
  }
  return v3(
    0.5 * (lo[0] + hi[0]),
    0.5 * (lo[1] + hi[1]),
    0.5 * (lo[2] + hi[2]),
  );
}

/**
 * Exact features for a field solid with constructive `source`.
 * Supports box, sphere, and CSG union/intersection/difference of them
 * (nested). Returns empty if source is missing or unsupported.
 */
export function exactFeatures(solid: FieldSolid): ExactFeatureSet | null {
  const src = solid.source;
  if (!src) return null;

  if (src.op === "box") {
    return boxFeatures(src.min, src.max);
  }

  if (src.op === "sphere") {
    // No sharp vertices/edges on a bare sphere.
    return { vertices: [], edges: [] };
  }

  if (src.op === "translate") {
    const inner = exactFeatures(src.solid);
    if (!inner) return null;
    const [tx, ty, tz] = src.offset;
    const map = (p: Vec3): Vec3 => v3(p[0] + tx, p[1] + ty, p[2] + tz);
    return {
      vertices: inner.vertices.map((v) => ({ position: map(v.position) })),
      edges: inner.edges.map((e) => {
        if (e.kind === "line") {
          const a = map(e.a);
          const b = map(e.b);
          return lineEdge(a, b);
        }
        return {
          ...e,
          a: map(e.a),
          b: map(e.b),
          center: map(e.center),
        };
      }),
    };
  }

  if (src.op === "union" || src.op === "intersection" || src.op === "difference") {
    return booleanFeatures(src.op, src.a, src.b);
  }

  // offset / smoothUnion / cylinder: not yet exact
  return null;
}

function booleanFeatures(
  op: "union" | "intersection" | "difference",
  a: FieldSolid,
  b: FieldSolid,
): ExactFeatureSet | null {
  // Specialized high-accuracy path: box ∪ sphere (demo + common pattern).
  const boxSph = boxUnionSphereFeatures(op, a, b);
  if (boxSph) return boxSph;

  // Generic: clip linear edges of each operand by the other solid.
  const fa = exactFeatures(a);
  const fb = exactFeatures(b);
  if (!fa && !fb) return null;

  const vertices: ExactVertex[] = [];
  const edges: ExactEdge[] = [];

  const keepA =
    op === "union"
      ? (p: Vec3) => outsideOrOn(b, p)
      : op === "intersection"
        ? (p: Vec3) => b.evaluate(p[0], p[1], p[2]) <= ON_SURFACE
        : (p: Vec3) => outsideOrOn(b, p); // difference a\b: keep A edges outside B

  const keepB =
    op === "union"
      ? (p: Vec3) => outsideOrOn(a, p)
      : op === "intersection"
        ? (p: Vec3) => a.evaluate(p[0], p[1], p[2]) <= ON_SURFACE
        : (p: Vec3) => a.evaluate(p[0], p[1], p[2]) <= ON_SURFACE; // B surface as cavity when inside A

  if (fa) {
    for (const e of fa.edges) {
      if (e.kind !== "line") continue;
      for (const seg of clipLineToKeep(e.a, e.b, keepA)) {
        edges.push(lineEdge(seg.a, seg.b));
        addVertex(vertices, seg.a);
        addVertex(vertices, seg.b);
      }
    }
    for (const v of fa.vertices) {
      if (keepA(v.position)) addVertex(vertices, v.position);
    }
  }
  if (fb && op !== "difference") {
    for (const e of fb.edges) {
      if (e.kind !== "line") continue;
      for (const seg of clipLineToKeep(e.a, e.b, keepB)) {
        edges.push(lineEdge(seg.a, seg.b));
        addVertex(vertices, seg.a);
        addVertex(vertices, seg.b);
      }
    }
    for (const v of fb.vertices) {
      if (keepB(v.position)) addVertex(vertices, v.position);
    }
  }

  return { vertices, edges };
}

/**
 * Exact features for box ∪ sphere (and argument order swap).
 * Vertices: surviving box corners + edge∩sphere points.
 * Edges: clipped box edges + sphere∩box-face circular arcs.
 */
function boxUnionSphereFeatures(
  op: "union" | "intersection" | "difference",
  a: FieldSolid,
  b: FieldSolid,
): ExactFeatureSet | null {
  if (op !== "union") return null;
  let box = a;
  let sph = b;
  if (a.source?.op === "sphere" && b.source?.op === "box") {
    box = b;
    sph = a;
  }
  if (box.source?.op !== "box" || sph.source?.op !== "sphere") return null;

  const { min, max } = box.source;
  const { center, radius } = sph.source;
  const pureBox = boxFeatures(min, max);
  const vertices: ExactVertex[] = [];
  const edges: ExactEdge[] = [];

  // Keep box corners outside-or-on the sphere.
  for (const v of pureBox.vertices) {
    if (outsideOrOn(sph, v.position)) addVertex(vertices, v.position);
  }

  // Clip each box edge to outside sphere.
  for (const e of pureBox.edges) {
    if (e.kind !== "line") continue;
    const segs = clipLineToKeep(e.a, e.b, (p) => outsideOrOn(sph, p));
    for (const seg of segs) {
      edges.push(lineEdge(seg.a, seg.b));
      addVertex(vertices, seg.a);
      addVertex(vertices, seg.b);
    }
  }

  // Sphere ∩ box face arcs (outside is automatic on face; clip to face rect).
  // For union, the crease is sphere surface on the cube face planes where
  // the face is outside the other faces... sphere∩face within face rectangle.
  const arcs = sphereBoxFaceArcs(center, radius, min, max, null);
  for (const arc of arcs) {
    // Keep arcs that lie on the union surface: on sphere and on/inside box
    // (face is on box). Verify endpoints on both.
    if (
      onSurface(sph, arc.a, 1e-5) &&
      onSurface(sph, arc.b, 1e-5) &&
      box.evaluate(arc.a[0], arc.a[1], arc.a[2]) <= 1e-5 &&
      box.evaluate(arc.b[0], arc.b[1], arc.b[2]) <= 1e-5
    ) {
      edges.push(arc);
      addVertex(vertices, arc.a);
      addVertex(vertices, arc.b);
    }
  }

  return { vertices, edges };
}

/** 1 micron in mm. */
export const MICRON_MM = 1e-3;

export function nearlyEqual(a: number, b: number, tol = MICRON_MM): boolean {
  return Math.abs(a - b) <= tol;
}

export function nearlyEqualVec(a: Vec3, b: Vec3, tol = MICRON_MM): boolean {
  return dist(a, b) <= tol;
}
