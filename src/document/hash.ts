/**
 * Content-addressed definition hashes for field / mesh caches.
 * Deterministic across runtimes (no crypto.subtle required).
 */

/**
 * Stable JSON: sorted object keys, arrays in order, no undefined keys.
 * Numbers as decimal; -0 normalized to 0.
 */
export function stableStringify(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  const t = typeof value;
  if (t === "number") {
    const n = value as number;
    if (Object.is(n, -0)) return "0";
    if (!Number.isFinite(n)) {
      throw new Error(`stableStringify: non-finite number ${n}`);
    }
    return String(n);
  }
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stringify).join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`).join(",")}}`;
  }
  throw new Error(`stableStringify: unsupported type ${t}`);
}

/** FNV-1a 64-bit → 16 hex chars (fast, stable, good enough for cache keys). */
export function hashString(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * Hash of kind + generator + payload (not part id).
 * Same geometry under a different id shares one field/mesh cache entry.
 */
export function definitionHash(input: {
  readonly kind: string;
  readonly generator: { readonly name: string; readonly version: number };
  readonly payload: unknown;
}): string {
  const body = stableStringify({
    kind: input.kind,
    generator: input.generator,
    payload: input.payload,
  });
  return `def:${hashString(body)}`;
}

/** Mesh cache key: field definition + tessellation quality. */
export function meshCacheKey(
  defHash: string,
  quality: { readonly cellSizeMm: number; readonly padMm?: number },
): string {
  const pad = quality.padMm ?? null;
  return `mesh:${defHash}:c${quality.cellSizeMm}:p${pad === null ? "d" : pad}`;
}
