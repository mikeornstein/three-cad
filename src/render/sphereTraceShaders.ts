/**
 * Vertex + fragment shader templates for AABB-bounded sphere tracing.
 * `MAP_SOURCE` is spliced with the compiled FieldNode map().
 */

/** Vertex: world-space position for ray origin/direction in the fragment. */
export const SPHERE_TRACE_VERTEX = /* glsl */ `
varying vec3 vWorldPos;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * Build fragment shader. `mapSource` must define `float map(vec3 p)`.
 *
 * Display modes (uMode): 0 solid, 1 mesh (edge-ish), 2 wire (silhouette).
 */
export function buildSphereTraceFragment(mapSource: string): string {
  return /* glsl */ `
precision highp float;

uniform vec3 uCameraPos;
uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
uniform vec3 uColor;
uniform vec3 uAmbient;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uFillDir;
uniform vec3 uFillColor;
uniform int uMaxSteps;
uniform float uSurfaceEps;
uniform float uNormalEps;
uniform int uMode;

varying vec3 vWorldPos;

${mapSource}

// Slab AABB intersection. Returns true if hit; tNear/tFar along ray.
bool intersectAabb(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out float tNear, out float tFar) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  tNear = max(max(tmin.x, tmin.y), tmin.z);
  tFar = min(min(tmax.x, tmax.y), tmax.z);
  return tFar >= max(tNear, 0.0);
}

vec3 calcNormal(vec3 p) {
  float e = uNormalEps;
  return normalize(vec3(
    map(p + vec3(e, 0.0, 0.0)) - map(p - vec3(e, 0.0, 0.0)),
    map(p + vec3(0.0, e, 0.0)) - map(p - vec3(0.0, e, 0.0)),
    map(p + vec3(0.0, 0.0, e)) - map(p - vec3(0.0, 0.0, e))
  ));
}

// Write correct depth for compositing with Three.js grid/axes.
void writeDepth(vec3 worldPos) {
  vec4 clip = uProjectionMatrix * uViewMatrix * vec4(worldPos, 1.0);
  float ndcZ = clip.z / clip.w;
  gl_FragDepth = ndcZ * 0.5 + 0.5;
}

void main() {
  vec3 ro = uCameraPos;
  vec3 rd = normalize(vWorldPos - uCameraPos);

  float tNear;
  float tFar;
  if (!intersectAabb(ro, rd, uBoundsMin, uBoundsMax, tNear, tFar)) {
    discard;
  }

  float t = max(tNear, 0.0);
  float hitT = -1.0;
  // Soft step scale for bound fields after CSG (slightly understep).
  const float stepScale = 0.85;

  for (int i = 0; i < 256; i++) {
    if (i >= uMaxSteps) break;
    if (t > tFar) break;
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < uSurfaceEps) {
      hitT = t;
      break;
    }
    t += max(d * stepScale, uSurfaceEps * 0.5);
  }

  if (hitT < 0.0) {
    discard;
  }

  vec3 pos = ro + rd * hitT;
  vec3 n = calcNormal(pos);
  vec3 v = normalize(uCameraPos - pos);

  // Wire mode: silhouette only
  if (uMode == 2) {
    float fres = abs(dot(n, v));
    if (fres > 0.22) discard;
    writeDepth(pos);
    gl_FragColor = vec4(uColor * 1.15, 1.0);
    return;
  }

  float ndlKey = max(dot(n, normalize(uKeyDir)), 0.0);
  float ndlFill = max(dot(n, normalize(uFillDir)), 0.0);
  vec3 lit = uAmbient * uColor
    + uKeyColor * uColor * ndlKey
    + uFillColor * uColor * ndlFill;

  // Mesh mode: darken where curvature is high (cheap normal-difference edge cue)
  if (uMode == 1) {
    float e = uNormalEps * 4.0;
    vec3 n2 = normalize(vec3(
      map(pos + vec3(e, 0.0, 0.0)) - map(pos - vec3(e, 0.0, 0.0)),
      map(pos + vec3(0.0, e, 0.0)) - map(pos - vec3(0.0, e, 0.0)),
      map(pos + vec3(0.0, 0.0, e)) - map(pos - vec3(0.0, 0.0, e))
    ));
    float edge = clamp(1.0 - abs(dot(n, n2)) * 8.0, 0.0, 1.0);
    lit = mix(lit, lit * 0.15, edge);
  }

  writeDepth(pos);
  gl_FragColor = vec4(lit, 1.0);
}
`;
}
