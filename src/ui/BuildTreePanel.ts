/**
 * Left-dock build tree: read-only view of PartDef / FieldNode construction.
 * Panel defaults collapsed to an icon rail; expand via the header toggle.
 */

import type { PartDef } from "../document/types";
import {
  buildTreeSummary,
  partToBuildTree,
  type BuildTreeNode,
} from "./buildTreeModel";

const WIDTH_EXPANDED = "260px";
const WIDTH_COLLAPSED = "40px";

export interface BuildTreePanelOptions {
  /** Called after a row is activated (clipboard already written when possible). */
  onActivate?: (node: BuildTreeNode, summary: string) => void;
  /** Panel chrome open state. Default: collapsed (icon rail). */
  panelCollapsed?: boolean;
}

export class BuildTreePanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly labelEl: HTMLElement;
  private readonly onActivate?: (node: BuildTreeNode, summary: string) => void;
  private tree: BuildTreeNode | null = null;
  private collapsed = new Set<string>();
  private selectedPath: string | null = null;
  private nodeByPath = new Map<string, BuildTreeNode>();
  private panelCollapsed: boolean;

  constructor(root: HTMLElement, options?: BuildTreePanelOptions) {
    this.root = root;
    this.onActivate = options?.onActivate;
    this.panelCollapsed = options?.panelCollapsed ?? true;
    this.root.classList.add("build-tree");
    this.root.setAttribute("role", "tree");
    this.root.setAttribute("aria-label", "Build tree");

    const existingToggle = this.root.querySelector<HTMLButtonElement>(
      ".build-tree-toggle",
    );
    const existingBody =
      this.root.querySelector<HTMLElement>(".build-tree-body");

    if (existingToggle && existingBody) {
      this.toggleBtn = existingToggle;
      this.body = existingBody;
      this.labelEl =
        existingToggle.querySelector<HTMLElement>(".build-tree-label") ??
        this.ensureLabel(existingToggle);
    } else {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "build-tree-toggle";

      const icon = document.createElement("span");
      icon.className = "build-tree-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = TREE_ICON_SVG;

      const label = document.createElement("span");
      label.className = "build-tree-label";
      label.textContent = "Build tree";

      toggle.append(icon, label);

      const body = document.createElement("div");
      body.className = "build-tree-body";

      this.root.replaceChildren(toggle, body);
      this.toggleBtn = toggle;
      this.body = body;
      this.labelEl = label;
    }

    this.toggleBtn.addEventListener("click", () => {
      this.setPanelCollapsed(!this.panelCollapsed);
    });

    this.applyPanelCollapsed();
  }

  setPanelCollapsed(collapsed: boolean): void {
    if (this.panelCollapsed === collapsed) {
      this.applyPanelCollapsed();
      return;
    }
    this.panelCollapsed = collapsed;
    this.applyPanelCollapsed();
  }

  setPart(part: PartDef | null): void {
    this.collapsed.clear();
    this.selectedPath = null;
    if (!part) {
      this.tree = null;
      this.nodeByPath.clear();
      this.render();
      return;
    }
    this.tree = partToBuildTree(part);
    this.nodeByPath = indexNodes(this.tree);
    // Expand all by default (shallow demo trees).
    this.collapsed.clear();
    this.render();
  }

  private ensureLabel(toggle: HTMLButtonElement): HTMLElement {
    const label = document.createElement("span");
    label.className = "build-tree-label";
    label.textContent = "Build tree";
    toggle.append(label);
    return label;
  }

  private applyPanelCollapsed(): void {
    this.root.classList.toggle("is-collapsed", this.panelCollapsed);
    const width = this.panelCollapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED;
    this.root.style.setProperty("--build-tree-width", width);
    document.documentElement.style.setProperty("--build-tree-width", width);

    this.toggleBtn.setAttribute(
      "aria-expanded",
      this.panelCollapsed ? "false" : "true",
    );
    this.toggleBtn.title = this.panelCollapsed
      ? "Expand build tree"
      : "Collapse build tree";
    this.toggleBtn.setAttribute(
      "aria-label",
      this.panelCollapsed ? "Expand build tree" : "Collapse build tree",
    );
    this.body.setAttribute("aria-hidden", this.panelCollapsed ? "true" : "false");
    this.labelEl.hidden = this.panelCollapsed;
  }

  private render(): void {
    this.body.replaceChildren();
    if (!this.tree) {
      const empty = document.createElement("div");
      empty.className = "build-tree-empty";
      empty.textContent = "No part loaded";
      this.body.append(empty);
      return;
    }
    this.body.append(this.renderNode(this.tree, 0));
  }

  private renderNode(node: BuildTreeNode, depth: number): HTMLElement {
    const hasChildren = !!(node.children && node.children.length > 0);
    const isCollapsed = hasChildren && this.collapsed.has(node.path);
    const isSelected = this.selectedPath === node.path;

    const row = document.createElement("div");
    row.className = "build-tree-row";
    row.dataset.path = node.path;
    row.dataset.op = node.op;
    if (node.leafId) row.dataset.leafId = node.leafId;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-selected", isSelected ? "true" : "false");
    if (hasChildren) {
      row.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    }
    row.style.setProperty("--depth", String(depth));
    if (isSelected) row.classList.add("is-selected");

    const twist = document.createElement("button");
    twist.type = "button";
    twist.className = "build-tree-twist";
    twist.tabIndex = -1;
    if (hasChildren) {
      twist.textContent = isCollapsed ? "▸" : "▾";
      twist.setAttribute(
        "aria-label",
        isCollapsed ? "Expand" : "Collapse",
      );
      twist.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.collapsed.has(node.path)) this.collapsed.delete(node.path);
        else this.collapsed.add(node.path);
        this.render();
      });
    } else {
      twist.textContent = "·";
      twist.disabled = true;
      twist.classList.add("is-leaf");
    }

    const main = document.createElement("button");
    main.type = "button";
    main.className = "build-tree-main";
    main.title = "Click to copy construction summary";

    const title = document.createElement("span");
    title.className = "build-tree-title";
    title.textContent = node.title;

    main.append(title);
    if (node.detail) {
      const detail = document.createElement("span");
      detail.className = "build-tree-detail";
      detail.textContent = node.detail;
      main.append(detail);
    }

    main.addEventListener("click", () => {
      this.activate(node);
    });

    row.append(twist, main);
    const wrap = document.createElement("div");
    wrap.className = "build-tree-node";
    wrap.append(row);

    if (hasChildren && !isCollapsed) {
      const group = document.createElement("div");
      group.className = "build-tree-children";
      group.setAttribute("role", "group");
      for (const child of node.children!) {
        group.append(this.renderNode(child, depth + 1));
      }
      wrap.append(group);
    }

    return wrap;
  }

  private activate(node: BuildTreeNode): void {
    this.selectedPath = node.path;
    const summary = buildTreeSummary(node);
    void copyText(summary);
    this.onActivate?.(node, summary);
    this.render();
  }
}

/** Simple list/tree mark — monochrome, matches chrome. */
const TREE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" focusable="false">' +
  '<rect x="2" y="2.5" width="12" height="1.75" rx="0.5"/>' +
  '<rect x="2" y="7.125" width="9" height="1.75" rx="0.5"/>' +
  '<rect x="2" y="11.75" width="11" height="1.75" rx="0.5"/>' +
  "</svg>";

function indexNodes(root: BuildTreeNode): Map<string, BuildTreeNode> {
  const map = new Map<string, BuildTreeNode>();
  const walk = (n: BuildTreeNode): void => {
    map.set(n.path, n);
    if (n.children) for (const c of n.children) walk(c);
  };
  walk(root);
  return map;
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through
  }
  // Fallback for restricted contexts
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    ta.remove();
  }
}
