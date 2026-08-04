import "./styles.css";
import { demoPartDef } from "./document/demoDocument";
import { createDemoSolid } from "./demo/createDemoSolid";
import { measureSelection } from "./measure/measureSelection";
import { SelectionController } from "./selection/SelectionController";
import type { TopologyIndex } from "./selection/topology";
import {
  formatSelectionClipboard,
  selectionFilterLabel,
  type SelectionRef,
} from "./selection/types";
import { BuildTreePanel } from "./ui/BuildTreePanel";
import { MeasureBar } from "./ui/MeasureBar";
import { OnscreenConsole } from "./ui/OnscreenConsole";
import { Viewport } from "./viewport/Viewport";

function main(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
  if (!canvas) {
    throw new Error("Missing #viewport canvas");
  }

  const consoleRoot = document.querySelector<HTMLElement>("#console");
  const screenConsole = consoleRoot
    ? new OnscreenConsole(consoleRoot)
    : null;

  const measureRoot = document.querySelector<HTMLElement>("#measure-bar");
  const measureBar = measureRoot ? new MeasureBar(measureRoot) : null;

  const buildTreeRoot = document.querySelector<HTMLElement>("#build-tree");
  const buildTree = buildTreeRoot
    ? new BuildTreePanel(buildTreeRoot, {
        onActivate: (_node, summary) => {
          screenConsole?.log(`build tree: ${summary}`);
        },
      })
    : null;
  buildTree?.setPart(demoPartDef());

  const viewport = new Viewport(canvas);
  const filterButton =
    document.querySelector<HTMLButtonElement>("#selection-filter");

  const selection = new SelectionController({
    scene: viewport.scene,
    camera: viewport.camera,
    canvas,
    onInfo: (message) => {
      screenConsole?.log(message);
    },
    onClipboardPayload: (text, refs) => {
      echoClipboard(screenConsole, text, refs);
    },
  });

  const refreshMeasures = (refs: readonly SelectionRef[]): void => {
    if (!measureBar) return;
    measureBar.update(measureSelection(refs, selection.getTopology()));
  };

  const syncBuildTreeLeaves = (refs: readonly SelectionRef[]): void => {
    if (!buildTree) return;
    buildTree.setActiveLeafIds(
      leafIdsFromSelection(refs, selection.getTopology()),
    );
  };

  selection.store.subscribe((refs) => {
    refreshMeasures(refs);
    syncBuildTreeLeaves(refs);
  });
  refreshMeasures(selection.store.getRefs());
  syncBuildTreeLeaves(selection.store.getRefs());

  const syncFilterButton = (): void => {
    if (!filterButton) return;
    const filter = selection.getFilter();
    filterButton.textContent = selectionFilterLabel(filter);
    filterButton.setAttribute(
      "aria-label",
      `Selection filter: ${selectionFilterLabel(filter)}. Click to cycle.`,
    );
    filterButton.dataset.filter = filter;
  };

  filterButton?.addEventListener("click", () => {
    selection.cycleFilter();
    syncFilterButton();
    screenConsole?.log(
      `selection filter → ${selectionFilterLabel(selection.getFilter())}`,
    );
  });

  window.addEventListener("keydown", (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (event.key === "f" || event.key === "F") {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      selection.cycleFilter();
      syncFilterButton();
      screenConsole?.log(
        `selection filter → ${selectionFilterLabel(selection.getFilter())}`,
      );
    }
    if (event.key === "Escape") {
      selection.store.clear();
    }
  });

  syncFilterButton();

  screenConsole?.log(
    "select: click · multi: shift+click · filter: F · clear: Esc / empty click",
  );
  screenConsole?.log("ids copy to clipboard; measures update in the bottom bar");
  screenConsole?.log(
    "kernel: SDF field solid · display: GPU sphere-trace (no mesh)",
  );
  screenConsole?.log(
    "eval: document PartDef → definitionHash cache → field; mesh export-only",
  );
  screenConsole?.log(
    "select: solid/face via field region (fill to creases) · edge/vertex later",
  );
  screenConsole?.log(
    "build tree (left): construction ops · click row to copy summary",
  );

  try {
    const solid = createDemoSolid();
    viewport.setContent(solid);
    selection.setMeshes(viewport.getSolidMeshes());
    refreshMeasures(selection.store.getRefs());
    syncBuildTreeLeaves(selection.store.getRefs());
    const hash = solid.userData.definitionHash as string | undefined;
    if (hash) {
      screenConsole?.log(`demo part hash: ${hash}`);
    }
  } catch (err) {
    console.error("Failed to build demo solid", err);
    screenConsole?.log(`error: failed to build demo solid — ${String(err)}`);
  }
}

/** Collect CSG leaf ids for selected faces (soft-sync build tree highlight). */
function leafIdsFromSelection(
  refs: readonly SelectionRef[],
  topology: TopologyIndex | null | undefined,
): string[] {
  if (!topology || refs.length === 0) return [];
  const leaves = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === "face") {
      const hit = topology.byEntityId.get(ref.id);
      if (!hit || hit.kind !== "face") continue;
      const face = hit.solid.faces[hit.localIndex];
      if (face?.leafId) leaves.add(face.leafId);
    } else if (ref.kind === "solid") {
      const solid = topology.solids.find((s) => s.solidEntityId === ref.id);
      if (!solid) continue;
      for (const f of solid.faces) {
        if (f.leafId) leaves.add(f.leafId);
      }
    }
  }
  return [...leaves];
}

function echoClipboard(
  screenConsole: OnscreenConsole | null,
  text: string,
  refs: readonly SelectionRef[],
): void {
  if (!screenConsole) return;
  if (refs.length === 0) {
    screenConsole.log("clipboard: (empty)");
    return;
  }
  const payload = text || formatSelectionClipboard(refs);
  screenConsole.log(`clipboard (${refs.length}):`);
  for (const line of payload.split("\n")) {
    screenConsole.log(`  ${line}`);
  }
}

main();
