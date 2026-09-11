// Renders deck.html to submission/bifrost-deck.pdf.
//   node submission/deck/render.mjs            → PDF
//   node submission/deck/render.mjs --png DIR  → one PNG per slide, for review
//
// Each PDF page is a 2x screenshot of its slide, with the deck's links laid back on top
// as real link annotations. A vector PDF from Chrome looks right in Chrome but not in
// Preview or Acrobat, which draw its soft shadows as grey boxes and misplace gradient
// text; an image renders the same in every viewer. The text lives in README/BUILD.md.
//
// Needs playwright-core resolvable (as tools/record.mjs does) and the same Chrome for
// Testing build.
import { chromium } from "playwright-core";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const W = 1920, H = 1080;

const browser = await chromium.launch({ executablePath: exe });
const png = process.argv.includes("--png");
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: png ? 1 : 2 });
await page.goto("file://" + path.join(here, "deck.html"), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const slides = await page.$$(".slide");

if (png) {
  const out = process.argv[process.argv.indexOf("--png") + 1] ?? here;
  for (let i = 0; i < slides.length; i++) {
    await slides[i].screenshot({ path: path.join(out, `slide-${String(i + 1).padStart(2, "0")}.png`) });
  }
  console.log(`${slides.length} slides → ${out}`);
} else {
  const pages = [];
  for (const slide of slides) {
    const shot = await slide.screenshot({ type: "jpeg", quality: 90 });
    const links = await slide.evaluate((el) => {
      const origin = el.getBoundingClientRect();
      return [...el.querySelectorAll("[data-href]")].map((a) => {
        const r = a.getBoundingClientRect();
        return { href: a.dataset.href, x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
      });
    });
    pages.push({ src: "data:image/jpeg;base64," + shot.toString("base64"), links });
  }

  const html = `<!doctype html><html><head><style>
    @page { size: ${W}px ${H}px; margin: 0; }
    html, body { margin: 0; }
    .p { position: relative; width: ${W}px; height: ${H}px; break-after: page; overflow: hidden; }
    .p:last-child { break-after: auto; }
    .p img { display: block; width: ${W}px; height: ${H}px; }
    .p a { position: absolute; display: block; }
  </style></head><body>${pages.map((p) => `<div class="p"><img src="${p.src}" />${p.links
    .map((l) => `<a href="${l.href}" style="left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px"></a>`)
    .join("")}</div>`).join("")}</body></html>`;

  const printer = await browser.newPage();
  await printer.setContent(html, { waitUntil: "load" });
  await printer.pdf({ path: path.join(here, "..", "bifrost-deck.pdf"), preferCSSPageSize: true, printBackground: true });
  console.log(`wrote submission/bifrost-deck.pdf (${pages.length} pages)`);
}
await browser.close();
