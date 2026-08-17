/**
 * Leaf-targeted, material-agnostic highlight for field solids.
 *
 * The shader wakes the targeted leaf (Fresnel / spec / base-tinted rim)
 * regardless of which material slot it uses. Interaction code talks in
 * leafIds and 0..1 amount — not amber uniforms or mat-1 slots.
 */

export const FIELD_HIGHLIGHT_USER = "threeCadFieldHighlight";

export type HighlightLevel = "rest" | "aware" | "engaged";

/** Wake strength written to the shader for each interaction level. */
export const HIGHLIGHT_AMOUNT: Record<HighlightLevel, number> = {
  rest: 0,
  aware: 0.72,
  engaged: 1,
};

export const HIGHLIGHT_EASE_MS = 140;

export interface FieldHighlight {
  /** Every named node in the compiled field, stable sorted order. */
  readonly leafIds: readonly string[];
  setTarget(leafId: string | null): void;
  getTarget(): string | null;
  /** 0..1 wake amount. 0 = rest look. */
  setAmount(amount: number): void;
  getAmount(): number;
  setLevel(level: HighlightLevel): void;
}

export function highlightLevelFor(input: {
  readonly hoverLeafId: string | null;
  readonly phase: "idle" | "pending" | "grabbing";
  readonly pointerButtons: number;
}): HighlightLevel {
  if (input.phase === "pending" || input.phase === "grabbing") {
    return "engaged";
  }
  if (input.hoverLeafId !== null && input.pointerButtons === 0) {
    return "aware";
  }
  return "rest";
}

/** CSS cursor for the current highlight / grab phase. */
export function highlightCursor(
  level: HighlightLevel,
  phase: "idle" | "pending" | "grabbing",
): string {
  if (phase === "grabbing") return "grabbing";
  if (level === "aware" || phase === "pending") return "grab";
  return "";
}

export function easeToward(
  current: number,
  target: number,
  dtMs: number,
  durationMs: number,
): number {
  if (durationMs <= 0) return target;
  const next = current + (target - current) * Math.min(1, dtMs / durationMs);
  return Math.abs(next - target) < 0.002 ? target : next;
}
