/**
 * Left-dock build tree: read-only view of PartDef / FieldNode construction.
 */

import type { PartDef } from "../document/types";
import {
  buildTreeSummary,
  partToBuildTree,
  type BuildTreeNode,
} from "./buildTreeModel";

export interface BuildTreePanelOptions {
  /** Called after a row is activated (clipboard already written when possible). */
  onActivate?: (node: BuildTreeNode, summary: string) => void;
}

export class BuildTreePanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly onActivate?: (node: BuildTreeNode, summary: string) => void;
  private tree: BuildTreeNode | null = null;
  private collapsed = new Set<string>();
  private selectedPath: string | null = null;
  private activeLeafIds = new Set<string>();
  private nodeByPath = new Map<string, BuildTreeNode>();

  constructor(root: HTMLElement, options?: BuildTreePanelOptions) {
    this.root = root;
    this.onActivate = options?.onActivate;
    this.root.classList.add("build-tree");
    this.root.setAttribute("role", "tree");
    this.root.setAttribute("aria-label", "Build tree");

    if (!this.root.querySelector(".build-tree-header")) {
      const header = document.createElement("div");
      header.className = "build-tree-header";
      header.textContent = "Build tree";
      const body = document.createElement("div");
      body.className = "build-tree-body";
      this.root.replaceChildren(header, body);
    }

    this.body =
      this.root.querySelector<HTMLElement>(".build-tree-body") ??
      this.root;
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

  setActiveLeafIds(ids: readonly string[]): void {
    this.activeLeafIds = new Set(ids.filter(Boolean));
    this.render();
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
    const leafActive =
      !!node.leafId && this.activeLeafIds.has(node.leafId);
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
    if (leafActive) row.classList.add("is-leaf-active");

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
