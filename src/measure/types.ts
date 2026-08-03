/** Structured measure report for the bottom bar (and later text channel). */

export interface MeasureField {
  /** Short label, e.g. "Area" */
  label: string;
  /** Formatted value ready for display */
  value: string;
  /** Optional raw numeric for future use */
  numeric?: number;
}

export interface MeasureReport {
  /** One-line title, e.g. "Face · face:demo/f0" */
  title: string;
  fields: MeasureField[];
  /** True when selection is empty */
  empty: boolean;
}
