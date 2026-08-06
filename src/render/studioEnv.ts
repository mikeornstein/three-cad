/**
 * Studio HDRI environment for field look-dev.
 *
 * Loads a real equirectangular HDR (CC0 Poly Haven) and exposes it for:
 * - scene.background / environment (Three.js) — rotated for Z-up
 * - custom WGSL sampling in the field sphere-trace shader
 *
 * Default: Poly Haven "Studio Small 08" — basic photo studio (softboxes /
 * octabox, infinity cove). Good for checking env orientation and glass IBL.
 *
 * Coordinate convention: three-cad is Z-up. HDR equirects are authored Y-up.
 * Viewport applies environmentRotation/backgroundRotation of Rx(+90°) so
 * HDR +Y (ceiling) maps to world +Z right-side up. Field shader matches.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearSRGBColorSpace,
  type Texture,
  Vector3,
} from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { PMREMGenerator, type WebGPURenderer } from "three/webgpu";

export interface StudioEnvironment {
  /** Equirectangular HDR (linear float) — for custom shader sampling. */
  readonly equirect: DataTexture;
  /** PMREM cubemap UV atlas — for scene.environment on PBR materials. */
  readonly pmrem: Texture;
  /** Asset id / filename stem for logging. */
  readonly id: string;
  /** Suggested env intensity for glass product stills. */
  readonly intensity: number;
  /** Rough key directions extracted from bright regions (Z-up world). */
  readonly keyDir: Vector3;
  readonly keyColor: Vector3;
  readonly fillDir: Vector3;
  readonly fillColor: Vector3;
  dispose(): void;
}

/**
 * Poly Haven "Studio Small 08" — basic photo studio softbox lighting.
 * 1k equirect, CC0.
 */
export const DEFAULT_HDR_ID = "studio_small_08";
const DEFAULT_HDR_URL = `${import.meta.env.BASE_URL}env/studio_small_08_1k.hdr`;
/**
 * World Z-up → equirect Y-up (same as Scene backgroundRotation Rx(+90°)):
 *   (x, y, z)_zup → (x, −z, y)_yup
 */
export function zUpDirectionToYUp(dir: Vector3): Vector3 {
  return new Vector3(dir.x, -dir.z, dir.y).normalize();
}

/**
 * Load studio HDRI, build PMREM, and estimate key/fill from the brightest
 * hemispheres. Call after WebGPURenderer.init().
 */
export async function loadStudioEnvironment(
  renderer: WebGPURenderer,
  url: string = DEFAULT_HDR_URL,
  intensity = 1.15,
): Promise<StudioEnvironment> {
  const loader = new HDRLoader();
  const equirect = (await loader.loadAsync(url)) as DataTexture;
  equirect.mapping = EquirectangularReflectionMapping;
  equirect.colorSpace = LinearSRGBColorSpace;
  equirect.minFilter = LinearFilter;
  equirect.magFilter = LinearFilter;
  equirect.wrapS = ClampToEdgeWrapping;
  equirect.wrapT = ClampToEdgeWrapping;
  equirect.needsUpdate = true;

  const pmremGenerator = new PMREMGenerator(renderer);
  const pmremRT = pmremGenerator.fromEquirectangular(equirect);
  const pmrem = pmremRT.texture;
  pmremGenerator.dispose();

  const probes = estimateLightProbes(equirect);
  const id =
    url.split("/").pop()?.replace(/_1k\.hdr$/i, "").replace(/\.hdr$/i, "") ??
    DEFAULT_HDR_ID;

  return {
    equirect,
    pmrem,
    id,
    intensity,
    keyDir: probes.keyDir,
    keyColor: probes.keyColor.multiplyScalar(intensity),
    fillDir: probes.fillDir,
    fillColor: probes.fillColor.multiplyScalar(intensity * 0.55),
    dispose() {
      equirect.dispose();
      pmrem.dispose();
      pmremRT.dispose();
    },
  };
}

/**
 * Walk equirect HDR texels, convert to directions, accumulate two brightest
 * lobes as key (upper) and fill (side). Directions converted to Z-up.
 */
function estimateLightProbes(tex: DataTexture): {
  keyDir: Vector3;
  keyColor: Vector3;
  fillDir: Vector3;
  fillColor: Vector3;
} {
  const img = tex.image as {
    data: Float32Array | Uint16Array;
    width: number;
    height: number;
  };
  const w = img.width;
  const h = img.height;
  const data = img.data;
  // HDRLoader typically yields Float32 RGBA or RGBE-unpacked float.
  const stride = data.length / (w * h);
  const isFloat = data instanceof Float32Array;

  let keyDir = new Vector3(0.4, -0.5, 0.8);
  let keyLum = 0;
  let keyCol = new Vector3(1, 1, 1);
  let fillDir = new Vector3(-0.6, 0.3, 0.4);
  let fillLum = 0;
  let fillCol = new Vector3(0.5, 0.6, 0.8);

  // Subsample for speed.
  const stepX = Math.max(1, Math.floor(w / 64));
  const stepY = Math.max(1, Math.floor(h / 32));

  for (let y = 0; y < h; y += stepY) {
    const v = (y + 0.5) / h;
    // equirect: v=0 top (Y-up +Y)
    const pitch = (0.5 - v) * Math.PI; // +pi/2 top
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    for (let x = 0; x < w; x += stepX) {
      const u = (x + 0.5) / w;
      const yaw = (u - 0.5) * Math.PI * 2;
      // standard equirect: x = cos(pitch)*sin(yaw), y = sin(pitch), z = cos(pitch)*cos(yaw)
      const yUpX = cosP * Math.sin(yaw);
      const yUpY = sinP;
      const yUpZ = cosP * Math.cos(yaw);
      // Y-up → Z-up inverse of Rx(+90°): (x, y, z)_yup → (x, z, −y)_zup
      const dir = new Vector3(yUpX, yUpZ, -yUpY);

      const i = (y * w + x) * stride;
      let r: number;
      let g: number;
      let b: number;
      if (isFloat) {
        r = data[i]!;
        g = data[i + 1]!;
        b = data[i + 2]!;
      } else {
        // half float fallback — treat as normalized
        r = data[i]! / 65535;
        g = data[i + 1]! / 65535;
        b = data[i + 2]! / 65535;
      }
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // Solid angle weight ~ cos(pitch) for equirect
      const weight = lum * Math.max(cosP, 0.05);

      if (dir.z > 0.15 && weight > keyLum) {
        keyLum = weight;
        keyDir = dir.clone();
        keyCol = new Vector3(r, g, b);
      }
      if (dir.z > -0.2 && dir.z < 0.6 && Math.abs(dir.x) > 0.2 && weight > fillLum) {
        fillLum = weight;
        fillDir = dir.clone();
        fillCol = new Vector3(r, g, b);
      }
    }
  }

  // Normalize colors to usable light intensities (HDR can be huge).
  const norm = (c: Vector3, targetPeak: number) => {
    const m = Math.max(c.x, c.y, c.z, 1e-4);
    return c.multiplyScalar(targetPeak / m);
  };

  return {
    keyDir: keyDir.normalize(),
    keyColor: norm(keyCol, 1.4),
    fillDir: fillDir.normalize(),
    fillColor: norm(fillCol, 0.55),
  };
}

