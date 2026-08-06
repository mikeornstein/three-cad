#!/usr/bin/env node
/**
 * Capture a viewport screenshot for material look-dev.
 *
 * Usage:
 *   node scripts/lookdev-capture.mjs [out.png] [url]
 *   LOOKDEV_HIDE_UI=1 node scripts/lookdev-capture.mjs tmp/lookdev/clean.png
 *
 * Requires: npm run dev (or preview) already serving the app; Playwright Chromium.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const outArg = process.argv[2] ?? "tmp/lookdev/capture.png";
const out = path.isAbsolute(outArg) ? outArg : path.join(root, outArg);
const url =
  process.argv[3] ??
  process.env.LOOKDEV_URL ??
  "http://127.0.0.1:5173/three-cad/";

fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  // WebGPU init + a few warm frames
  await page.waitForTimeout(2800);

  if (process.env.LOOKDEV_HIDE_UI === "1") {
    await page.addStyleTag({
      content: `
        #build-tree,
        #console,
        #fps-meter,
        [data-panel],
        .status-bar {
          display: none !important;
        }
      `,
    });
    await page.waitForTimeout(100);
  }

  await page.screenshot({ path: out, type: "png" });
  console.log(`lookdev: wrote ${path.relative(root, out)}`);
} catch (err) {
  console.error("lookdev: capture failed — is the dev server running?", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
