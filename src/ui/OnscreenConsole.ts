/**
 * Lightweight on-screen log for selection / clipboard confirmation.
 * Not a full REPL — just a confirmation surface for pick feedback.
 */
export class OnscreenConsole {
  private readonly logEl: HTMLElement;
  private readonly maxLines: number;
  private lines: string[] = [];

  constructor(
    root: HTMLElement,
    options?: { maxLines?: number },
  ) {
    this.maxLines = options?.maxLines ?? 80;
    this.logEl =
      root.querySelector<HTMLElement>("#console-log") ??
      this.createStructure(root);
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

  private createStructure(root: HTMLElement): HTMLElement {
    root.innerHTML = "";
    const header = document.createElement("div");
    header.className = "console-header";
    header.textContent = "Console";
    const log = document.createElement("pre");
    log.id = "console-log";
    log.className = "console-log";
    root.append(header, log);
    return log;
  }
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
