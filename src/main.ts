import "./styles.css";
import { createDemoSolid } from "./demo/createDemoSolid";
import { measureSelection } from "./measure/measureSelection";
import { SelectionController } from "./selection/SelectionController";
import {
  formatSelectionClipboard,
  selectionFilterLabel,
  type SelectionRef,
} from "./selection/types";
import { MeasureBar } from "./ui/MeasureBar";
import { OnscreenConsole } from "./ui/OnscreenConsole";
import { displayModeLabel, Viewport } from "./viewport/Viewport";

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

  const viewport = new Viewport(canvas);
  const modeButton = document.querySelector<HTMLButtonElement>("#display-mode");
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

  selection.store.subscribe(refreshMeasures);
  refreshMeasures(selection.store.getRefs());

  const syncModeButton = (): void => {
    if (!modeButton) return;
    const mode = viewport.getDisplayMode();
    modeButton.textContent = displayModeLabel(mode);
    modeButton.setAttribute(
      "aria-label",
      `Display mode: ${displayModeLabel(mode)}. Click to cycle.`,
    );
    modeButton.dataset.mode = mode;
  };

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

  modeButton?.addEventListener("click", () => {
    viewport.cycleDisplayMode();
    syncModeButton();
  });

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
    if (event.key === "m" || event.key === "M") {
      viewport.cycleDisplayMode();
      syncModeButton();
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

  syncModeButton();
  syncFilterButton();

  screenConsole?.log(
    "select: click · multi: shift+click · filter: F · clear: Esc / empty click",
  );
  screenConsole?.log("ids copy to clipboard; measures update in the bottom bar");
  screenConsole?.log("kernel: SDF field solid (mesh is display derivative)");

  try {
    const solid = createDemoSolid();
    viewport.setContent(solid);
    selection.setMeshes(viewport.getSolidMeshes());
    refreshMeasures(selection.store.getRefs());
  } catch (err) {
    console.error("Failed to build demo solid", err);
    screenConsole?.log(`error: failed to build demo solid — ${String(err)}`);
  }
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
