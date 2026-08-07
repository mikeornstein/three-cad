/**
 * Acquire a real WebGPU device without Three.js's hard-coded
 * `requestAdapter({ featureLevel: "compatibility" })` path.
 *
 * Three r185 (and current upstream) always requests compatibility mode.
 * On browsers that do not implement that option (Safari, some Chromium
 * builds), the adapter is null even though plain requestAdapter() works —
 * Three then falls back to WebGL2 and three-cad rejects the backend.
 *
 * Also surfaces secure-context failures: LAN HTTP (http://192.168.x.x)
 * hides `navigator.gpu` entirely.
 */

/** Optional features Three enables when the adapter supports them. */
const OPTIONAL_FEATURES = [
  "core-features-and-limits",
  "depth-clip-control",
  "depth32float-stencil8",
  "texture-compression-bc",
  "texture-compression-bc-sliced-3d",
  "texture-compression-etc2",
  "texture-compression-astc",
  "texture-compression-astc-sliced-3d",
  "timestamp-query",
  "indirect-first-instance",
  "shader-f16",
  "rg11b10ufloat-renderable",
  "bgra8unorm-storage",
  "float32-filterable",
  "float32-blendable",
  "clip-distances",
  "dual-source-blending",
  "subgroups",
  "texture-formats-tier1",
  "texture-formats-tier2",
] as const;

export interface WebGpuDeviceInfo {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  /** Preferred swapchain format for diagnostics. */
  readonly preferredFormat: GPUTextureFormat;
  /** Features enabled on the device. */
  readonly features: readonly string[];
  /** One-line summary for the on-screen console. */
  readonly summary: string;
}

/**
 * Create a GPUDevice suitable for `new WebGPURenderer({ device })`.
 * Never passes `featureLevel` to requestAdapter.
 */
export async function createWebGpuDevice(
  options: {
    readonly powerPreference?: GPUPowerPreference;
  } = {},
): Promise<WebGpuDeviceInfo> {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new Error(
      "WebGPU requires a secure context (HTTPS or http://localhost / 127.0.0.1). " +
        "Opening via a LAN IP (http://192.168.x.x) or plain HTTP hides navigator.gpu. " +
        "Use the GitHub Pages deploy, localhost, or an HTTPS tunnel for phone testing.",
    );
  }

  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new Error(
      "navigator.gpu is missing. Use Chrome, Edge, Firefox, or Safari 26+ with WebGPU enabled, " +
        "over HTTPS or localhost (secure context).",
    );
  }

  // Do not pass featureLevel — unsupported values make requestAdapter return null.
  const powerPreference = options.powerPreference ?? "high-performance";
  let adapter =
    (await navigator.gpu.requestAdapter({ powerPreference })) ?? null;
  if (!adapter) {
    adapter = (await navigator.gpu.requestAdapter()) ?? null;
  }
  if (!adapter) {
    throw new Error(
      "WebGPU adapter unavailable (requestAdapter returned null). " +
        "GPU may be blocked, disabled, or unsupported in this browser profile.",
    );
  }

  const requiredFeatures: string[] = [];
  for (const name of OPTIONAL_FEATURES) {
    if (adapter.features.has(name)) {
      requiredFeatures.push(name);
    }
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({
      requiredFeatures: requiredFeatures as GPUFeatureName[],
    });
  } catch (err) {
    // Feature combination can fail on strict implementations — retry bare device.
    try {
      device = await adapter.requestDevice();
    } catch (err2) {
      throw new Error(
        `WebGPU requestDevice failed: ${String(err2)} (after features attempt: ${String(err)})`,
      );
    }
  }

  const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
  const features = [...device.features];
  const summary =
    `WebGPU device · format ${preferredFormat}` +
    (features.includes("float32-filterable") ? " · float32-filterable" : "") +
    (features.includes("core-features-and-limits") ? " · core" : " · limited");

  return {
    adapter,
    device,
    preferredFormat,
    features,
    summary,
  };
}

/** Coarse pointer / phone-like client for quality caps. */
export function isMobileLikeClient(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const touch = navigator.maxTouchPoints > 0;
  const narrow = window.innerWidth > 0 && window.innerWidth <= 900;
  return coarse || (touch && narrow);
}
