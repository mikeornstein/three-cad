/**
 * Repro / verify: select sphere∩cube intersection edges (quarter-circles).
 *
 * Demo solid: 100 mm cube ∪ sphere r=50 at (100,100,100).
 * Expected curved edges: three quarter-circles of length 25π ≈ 78.54 mm
 * on faces x=100, y=100, z=100.
 *
 * Usage: APP_URL=http://localhost:5175/ node scripts/screenshot-sphere-edges.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.APP_URL || "http://localhost:5175/";
const OUT = join(process.cwd(), "tmp", "screenshots-sphere-edge");
mkdirSync(OUT, { recursive: true });

/** Heuristic: arc endpoints are not both pure orthant cube-edge samples. */
function looksLikeArc(edgeId) {
  const m = edgeId.match(
    /e-([-\d.]+)-([-\d.]+)-([-\d.]+)_([-\d.]+)-([-\d.]+)-([-\d.]+)/,
  );
  if (!m) return false;
  const nums = m.slice(1).map(Number);
  // Cube edges: two of (a,b) share two axis-aligned coords at 0 or 100.
  // Arcs: mid-range coords (~50–100) on a face plane.
  const mid = nums.filter((v) => Math.abs(v) > 5 && Math.abs(v) < 95);
  return mid.length >= 2;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const canvas = page.locator("#viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");

  // Edge filter
  const btn = page.locator("#selection-filter");
  for (let i = 0; i < 8; i++) {
    if ((await btn.innerText()).trim() === "Edge") break;
    await btn.click();
    await page.waitForTimeout(80);
  }

  await page.screenshot({ path: join(OUT, "00-edge-filter.png") });

  const results = [];
  let n = 0;
  // Dense grid over the sphere∩cube crease region (screen space).
  for (let fy = 0.35; fy <= 0.62; fy += 0.03) {
    for (let fx = 0.42; fx <= 0.62; fx += 0.03) {
      n++;
      const name = `click-${String(n).padStart(2, "0")}-fx${fx.toFixed(2)}-fy${fy.toFixed(2)}`;
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(500);
      const log = await page.locator("#console-log").innerText();
      const lines = log.split("\n");
      const lastSel = [...lines].reverse().find((l) =>
        /face:|edge:|vertex:|solid:|clipboard: \(empty\)/.test(l),
      );
      const last = lastSel?.trim() ?? "";
      const isEdge = last.includes("edge:");
      const isArc = isEdge && looksLikeArc(last);
      results.push({ name, fx: +fx.toFixed(2), fy: +fy.toFixed(2), isEdge, isArc, last });
      if (isEdge || n % 5 === 1) {
        await page.screenshot({ path: join(OUT, `${name}.png`) });
      }
    }
  }

  const edges = results.filter((r) => r.isEdge);
  const arcs = results.filter((r) => r.isArc);
  writeFileSync(
    join(OUT, "results.json"),
    JSON.stringify({ results, edges, arcs }, null, 2),
  );
  console.log("Total clicks", results.length);
  console.log("Edge hits", edges.length);
  console.log("Likely sphere∩cube arcs", arcs.length);
  console.log("ARCS:");
  console.log(JSON.stringify(arcs, null, 2));
  console.log("ALL EDGES:");
  console.log(JSON.stringify(edges, null, 2));
  await page.screenshot({ path: join(OUT, "zz-final.png") });
  await browser.close();

  if (arcs.length === 0) {
    console.error("FAIL: no sphere∩cube arc edges selected");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
