/** Viewport shading / topology inspection modes. */
export type DisplayMode = "solid" | "mesh" | "wireframe";

export const DISPLAY_MODES: readonly DisplayMode[] = [
  "solid",
  "mesh",
  "wireframe",
] as const;

export function nextDisplayMode(current: DisplayMode): DisplayMode {
  const i = DISPLAY_MODES.indexOf(current);
  return DISPLAY_MODES[(i + 1) % DISPLAY_MODES.length]!;
}

export function displayModeLabel(mode: DisplayMode): string {
  switch (mode) {
    case "solid":
      return "Solid";
    case "mesh":
      return "Mesh";
    case "wireframe":
      return "Wire";
  }
}
