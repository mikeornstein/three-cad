/**
 * Verify face areas in UI: full −x, cut +x, freeform sphere.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.APP_URL || "http://localhost:5175/";
const OUT = join(process.cwd(), "tmp", "screenshots-face-area");
mkdirSync(OUT, { recursive: true });

async function setFilter(page, want) {
  const btn = page.locator("#selection-filter");
  for (let i = 0; i < 10; i++) {
    if ((await btn.innerText()).trim() === want) return;
    await btn.click();
    await page.waitForTimeout(80);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  await setFilter(page, "Face");

  const canvas = page.locator("#viewport");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");

  const targets = [
    ["plus-x-cut", 0.48, 0.58],
    ["plus-z-cut", 0.42, 0.42],
    ["sphere", 0.62, 0.42],
    ["neg-y", 0.40, 0.70],
  ];
  const results = [];
  for (const [name, fx, fy] of targets) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(1200);
    const data = await page.evaluate(() => {
      const lines = document.body.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
      const mm2 = lines.filter((l) => /mm²/.test(l));
      const face = [...lines].reverse().find((l) => /face:|Face ·/.test(l));
      const planar = lines.find((l) => l === "yes" || l.includes("curved"));
      return { face, mm2, snippet: lines.filter((l) => /face|Area|AREA|mm²|Planar|field/i.test(l)).slice(-20) };
    });
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    results.push({ name, fx, fy, ...data });
    console.log(name, JSON.stringify(data));
  }
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
