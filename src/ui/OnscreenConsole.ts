/**
 * Lightweight on-screen log for selection / clipboard confirmation.
 * Not a full REPL — just a confirmation surface for pick feedback.
 * Defaults collapsed to an icon chip; expand via the header toggle.
 */

export class OnscreenConsole {
  private readonly root: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly labelEl: HTMLElement;
  private readonly maxLines: number;
  private lines: string[] = [];
  private collapsed: boolean;

  constructor(
    root: HTMLElement,
    options?: { maxLines?: number; collapsed?: boolean },
  ) {
    this.root = root;
    this.maxLines = options?.maxLines ?? 80;
    this.collapsed = options?.collapsed ?? true;

    const existingLog = root.querySelector<HTMLElement>("#console-log");
    const existingToggle =
      root.querySelector<HTMLButtonElement>(".console-toggle");

    if (existingLog && existingToggle) {
      this.logEl = existingLog;
      this.toggleBtn = existingToggle;
      this.labelEl =
        existingToggle.querySelector<HTMLElement>(".console-label") ??
        this.ensureLabel(existingToggle);
    } else if (existingLog) {
      // Upgrade legacy header markup from index.html.
      const oldHeader = root.querySelector(".console-header");
      oldHeader?.remove();
      this.toggleBtn = this.makeToggle();
      root.insertBefore(this.toggleBtn, existingLog);
      this.logEl = existingLog;
      this.labelEl =
        this.toggleBtn.querySelector<HTMLElement>(".console-label")!;
    } else {
      this.logEl = this.createStructure(root);
      this.toggleBtn = root.querySelector<HTMLButtonElement>(".console-toggle")!;
      this.labelEl =
        this.toggleBtn.querySelector<HTMLElement>(".console-label")!;
    }

    this.toggleBtn.addEventListener("click", () => {
      this.setCollapsed(!this.collapsed);
    });

    this.applyCollapsed();
  }

  setCollapsed(collapsed: boolean): void {
    if (this.collapsed === collapsed) {
      this.applyCollapsed();
      return;
    }
    this.collapsed = collapsed;
    this.applyCollapsed();
  }

  log(message: string): void {
    const stamp = timestamp();
    const parts = message.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const line = i === 0 ? `${stamp} ${parts[i]}` : `         ${parts[i]}`;
      this.lines.push(line);
    }
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(-this.maxLines);
    }
    this.logEl.textContent = this.lines.join("\n");
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  clear(): void {
    this.lines = [];
    this.logEl.textContent = "";
  }

  private ensureLabel(toggle: HTMLButtonElement): HTMLElement {
    const label = document.createElement("span");
    label.className = "console-label";
    label.textContent = "Console";
    toggle.append(label);
    return label;
  }

  private makeToggle(): HTMLButtonElement {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "console-toggle";

    const icon = document.createElement("span");
    icon.className = "console-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = CONSOLE_ICON_SVG;

    const label = document.createElement("span");
    label.className = "console-label";
    label.textContent = "Console";

    toggle.append(icon, label);
    return toggle;
  }

  private createStructure(root: HTMLElement): HTMLElement {
    root.innerHTML = "";
    const toggle = this.makeToggle();
    const log = document.createElement("pre");
    log.id = "console-log";
    log.className = "console-log";
    root.append(toggle, log);
    return log;
  }

  private applyCollapsed(): void {
    this.root.classList.toggle("is-collapsed", this.collapsed);
    this.toggleBtn.setAttribute(
      "aria-expanded",
      this.collapsed ? "false" : "true",
    );
    this.toggleBtn.title = this.collapsed
      ? "Expand console"
      : "Collapse console";
    this.toggleBtn.setAttribute(
      "aria-label",
      this.collapsed ? "Expand console" : "Collapse console",
    );
    this.logEl.setAttribute("aria-hidden", this.collapsed ? "true" : "false");
    this.labelEl.hidden = this.collapsed;
  }
}

/** Terminal prompt mark — monochrome, matches chrome. */
const CONSOLE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" focusable="false">' +
  '<path d="M3.2 4.1 6.6 7.5 3.2 10.9l1.1 1.1 4.5-4.5L4.3 3z"/>' +
  '<rect x="8.2" y="11.1" width="5" height="1.6" rx="0.4"/>' +
  "</svg>";

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
