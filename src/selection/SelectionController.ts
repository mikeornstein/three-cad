import type { Mesh, Object3D, PerspectiveCamera, Scene } from "three";
import { SelectionHighlight } from "./highlight";
import { buildPickHelpers, pickAtPointer } from "./pick";
import { SelectionStore } from "./SelectionStore";
import { buildTopologyIndex, type TopologyIndex } from "./topology";
import {
  formatSelectionClipboard,
  nextSelectionFilter,
  type SelectionFilter,
  type SelectionRef,
} from "./types";

export interface SelectionControllerOptions {
  scene: Scene;
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /**
   * Called after every selection change with the clipboard payload
   * (one id per line, or "" when empty).
   */
  onClipboardPayload?: (text: string, refs: readonly SelectionRef[]) => void;
  /** Optional informational messages (topology ready, etc.). */
  onInfo?: (message: string) => void;
}

const CLICK_MOVE_PX = 5;

/**
 * Owns topology, multi-select, pointer picking, highlights, and clipboard payload.
 * Does not implement measure/edit actions — only selection context.
 */
export class SelectionController {
  readonly store = new SelectionStore();
  readonly highlight = new SelectionHighlight();

  private topology: TopologyIndex | null = null;
  private pickHelpers: Object3D[] = [];
  private solidMeshes: Mesh[] = [];
  private filter: SelectionFilter = "all";
  private disposed = false;

  private pointerDown: {
    x: number;
    y: number;
    pointerId: number;
  } | null = null;

  private readonly opts: SelectionControllerOptions;
  private unsubStore: (() => void) | null = null;

  constructor(opts: SelectionControllerOptions) {
    this.opts = opts;
    opts.scene.add(this.highlight.group);

    this.unsubStore = this.store.subscribe((refs) => {
      this.highlight.update(refs);
      this.emitClipboard(refs);
    });

    const el = opts.canvas;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerCancel);
  }

  getFilter(): SelectionFilter {
    return this.filter;
  }

  setFilter(filter: SelectionFilter): SelectionFilter {
    this.filter = filter;
    return this.filter;
  }

  cycleFilter(): SelectionFilter {
    this.filter = nextSelectionFilter(this.filter);
    return this.filter;
  }

  /**
   * Rebuild topology + pick helpers from the current solid meshes.
   * Call after Viewport.setContent (or whenever evaluated geometry changes).
   */
  setMeshes(meshes: readonly Mesh[]): void {
    this.disposePickHelpers();
    this.solidMeshes = [...meshes];
    this.topology = buildTopologyIndex(this.solidMeshes);
    this.highlight.setTopology(this.topology);
    this.pickHelpers = buildPickHelpers(this.topology);
    for (const h of this.pickHelpers) {
      this.opts.scene.add(h);
    }
    this.store.clear();

    const summary = this.topology.solids
      .map(
        (s) =>
          `${s.solidId}: ${s.faces.length} faces, ${s.edges.length} edges, ${s.vertices.length} verts`,
      )
      .join("; ");
    this.opts.onInfo?.(`topology ready — ${summary}`);
  }

  getTopology(): TopologyIndex | null {
    return this.topology;
  }

  getTopologySummary(): string {
    if (!this.topology) return "no topology";
    return this.topology.solids
      .map(
        (s) =>
          `${s.solidId}: ${s.faces.length}f ${s.edges.length}e ${s.vertices.length}v`,
      )
      .join(", ");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const el = this.opts.canvas;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerCancel);
    this.unsubStore?.();
    this.unsubStore = null;
    this.disposePickHelpers();
    this.highlight.dispose();
  }

  private disposePickHelpers(): void {
    for (const h of this.pickHelpers) {
      h.removeFromParent();
      // Geometry/materials on helpers
      const any = h as unknown as {
        geometry?: { dispose: () => void };
        material?: { dispose: () => void } | { dispose: () => void }[];
      };
      any.geometry?.dispose();
      if (Array.isArray(any.material)) {
        for (const m of any.material) m.dispose();
      } else {
        any.material?.dispose();
      }
    }
    this.pickHelpers = [];
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDown = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  };

  private readonly onPointerCancel = (): void => {
    this.pointerDown = null;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.pointerId !== event.pointerId) return;

    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    if (dx * dx + dy * dy > CLICK_MOVE_PX * CLICK_MOVE_PX) {
      // Treated as orbit/pan drag — do not change selection.
      return;
    }

    if (!this.topology) return;

    const hit = pickAtPointer(event.clientX, event.clientY, {
      camera: this.opts.camera,
      canvas: this.opts.canvas,
      solidMeshes: this.solidMeshes,
      pickHelpers: this.pickHelpers,
      topology: this.topology,
      filter: this.filter,
    });

    if (event.shiftKey) {
      if (hit) this.store.toggle(hit);
      // Shift + miss: keep selection (CAD-style).
      return;
    }

    if (hit) {
      this.store.set([hit]);
    } else {
      this.store.clear();
    }
  };

  private emitClipboard(refs: readonly SelectionRef[]): void {
    const text = formatSelectionClipboard(refs);
    // Always notify UI (console). Clipboard write is best-effort.
    this.opts.onClipboardPayload?.(text, refs);

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      // Empty selection → clear clipboard payload to "" so paste state matches UI.
      void navigator.clipboard.writeText(text).catch(() => {
        // Permissions / non-secure context — console still shows the payload.
      });
    }
  }
}
