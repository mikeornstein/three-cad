import type { SelectionRef } from "./types";

export type SelectionListener = (refs: readonly SelectionRef[]) => void;

/**
 * Ordered multi-selection. Identity is `SelectionRef.id`.
 * Click replace / Shift toggle are applied by the controller; this store only holds state.
 */
export class SelectionStore {
  private readonly items: SelectionRef[] = [];
  private readonly listeners = new Set<SelectionListener>();

  get size(): number {
    return this.items.length;
  }

  getRefs(): readonly SelectionRef[] {
    return this.items;
  }

  has(id: string): boolean {
    return this.items.some((r) => r.id === id);
  }

  /** Replace entire selection (plain click). */
  set(refs: readonly SelectionRef[]): void {
    this.items.length = 0;
    const seen = new Set<string>();
    for (const r of refs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      this.items.push(r);
    }
    this.emit();
  }

  clear(): void {
    if (this.items.length === 0) return;
    this.items.length = 0;
    this.emit();
  }

  /**
   * Shift-click: toggle membership. Adding appends; removing keeps relative order of others.
   */
  toggle(ref: SelectionRef): void {
    const i = this.items.findIndex((r) => r.id === ref.id);
    if (i >= 0) {
      this.items.splice(i, 1);
    } else {
      this.items.push(ref);
    }
    this.emit();
  }

  subscribe(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.items.slice();
    for (const l of this.listeners) l(snapshot);
  }
}
