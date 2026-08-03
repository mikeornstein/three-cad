import type { MeasureReport } from "../measure/types";

/**
 * Bottom bar showing human-readable measureables for the current selection.
 */
export class MeasureBar {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly fieldsEl: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add("measure-bar");
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");

    let title = root.querySelector<HTMLElement>(".measure-bar-title");
    let fields = root.querySelector<HTMLElement>(".measure-bar-fields");
    if (!title || !fields) {
      root.innerHTML = "";
      title = document.createElement("div");
      title.className = "measure-bar-title";
      fields = document.createElement("div");
      fields.className = "measure-bar-fields";
      root.append(title, fields);
    }
    this.titleEl = title;
    this.fieldsEl = fields;
    this.showEmpty();
  }

  update(report: MeasureReport): void {
    this.root.dataset.empty = report.empty ? "true" : "false";
    this.titleEl.textContent = report.title;
    this.fieldsEl.replaceChildren();

    for (const f of report.fields) {
      const item = document.createElement("div");
      item.className = "measure-field";

      const label = document.createElement("span");
      label.className = "measure-field-label";
      label.textContent = f.label;

      const value = document.createElement("span");
      value.className = "measure-field-value";
      value.textContent = f.value;
      value.title = "Click to copy";
      value.tabIndex = 0;
      value.addEventListener("click", () => {
        void copyText(f.value);
        value.classList.add("copied");
        window.setTimeout(() => value.classList.remove("copied"), 600);
      });
      value.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          value.click();
        }
      });

      item.append(label, value);
      this.fieldsEl.append(item);
    }
  }

  showEmpty(): void {
    this.update({
      title: "No selection",
      fields: [{ label: "Hint", value: "Click geometry to measure" }],
      empty: true,
    });
  }
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    // ignore
  }
}
