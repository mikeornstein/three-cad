/**
 * Matrix of face / edge / vertex picks + timing. Writes tmp/screenshots/*.png
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.APP_URL || "http://localhost:5175/";
const OUT = join(process.cwd(), "tmp", "screenshots");
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
  });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1800);

  const canvas = page.locator("#viewport");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");

  const timings = [];

  async function shot(name) {
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  }

  async function clickFrac(fx, fy) {
    const t0 = performance.now();
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    // Wait until measure bar or console updates (UI unfreeze)
    await page.waitForTimeout(50);
    // Poll console for clipboard update up to 3s
    let elapsed = 0;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(50);
      elapsed = performance.now() - t0;
      const log = await page.locator("#console-log").innerText();
      if (log.includes("clipboard")) break;
    }
    // Allow highlight animation
    await page.waitForTimeout(350);
    return performance.now() - t0;
  }

  async function setFilter(label) {
    const btn = page.locator("#selection-filter");
    for (let i = 0; i < 6; i++) {
      const t = (await btn.innerText()).trim();
      if (t === label) return;
      await btn.click();
      await page.waitForTimeout(80);
    }
  }

  await shot("00-initial");

  // Face filter — click grid covering the solid
  await setFilter("Face");
  const faceClicks = [
    ["face-a", 0.42, 0.48],
    ["face-b", 0.5, 0.42],
    ["face-c", 0.58, 0.48],
    ["face-d", 0.5, 0.55],
    ["face-e", 0.48, 0.5],
    ["face-f", 0.62, 0.52],
    ["face-g", 0.45, 0.58],
    ["face-h", 0.55, 0.38],
  ];
  for (const [name, fx, fy] of faceClicks) {
    const ms = await clickFrac(fx, fy);
    const log = await page.locator("#console-log").innerText();
    const last = log.split("\n").filter((l) => l.includes("face:") || l.includes("solid:")).slice(-1)[0] || "";
    timings.push({ name, ms: Math.round(ms), last });
    await shot(name);
  }

  // Edge filter
  await setFilter("Edge");
  const edgeClicks = [
    ["edge-a", 0.45, 0.52],
    ["edge-b", 0.52, 0.45],
    ["edge-c", 0.48, 0.4],
    ["edge-d", 0.4, 0.48],
  ];
  for (const [name, fx, fy] of edgeClicks) {
    const ms = await clickFrac(fx, fy);
    const log = await page.locator("#console-log").innerText();
    const last = log.split("\n").filter((l) => l.includes("edge:") || l.includes("clipboard")).slice(-2).join(" ");
    timings.push({ name, ms: Math.round(ms), last });
    await shot(name);
  }

  // Vertex filter
  await setFilter("Vertex");
  const vertClicks = [
    ["vert-a", 0.44, 0.44],
    ["vert-b", 0.5, 0.4],
    ["vert-c", 0.4, 0.5],
    ["vert-d", 0.48, 0.48],
  ];
  for (const [name, fx, fy] of vertClicks) {
    const ms = await clickFrac(fx, fy);
    const log = await page.locator("#console-log").innerText();
    const last = log.split("\n").filter((l) => l.includes("vertex:") || l.includes("clipboard")).slice(-2).join(" ");
    timings.push({ name, ms: Math.round(ms), last });
    await shot(name);
  }

  writeFileSync(join(OUT, "timings.json"), JSON.stringify(timings, null, 2));
  console.log(JSON.stringify(timings, null, 2));
  console.log("Wrote", OUT);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
