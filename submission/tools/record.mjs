// Records the Bifrost submission video from the live portal.
// CDP screencast (JPEG frames with wall-clock timestamps) → ffmpeg CFR H.264 later.
import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const OUT = process.argv[2];
const FRAMES = path.join(OUT, "frames");
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const APP = "http://localhost:5173/#";
const VIEW = { width: 1600, height: 900 };
const DPR = 1.2; // → 1920×1080 frames

const b = await chromium.launch({ executablePath: exe });

// Warm the indexer cache so every scene opens on data, not skeletons.
{
  const warm = await b.newContext({ viewport: VIEW });
  const p = await warm.newPage();
  await p.goto(APP + "/app");
  await p.waitForTimeout(11000);
  fs.writeFileSync(path.join(OUT, "state.json"), JSON.stringify(await warm.storageState()));
  await warm.close();
}

const ctx = await b.newContext({
  viewport: VIEW, deviceScaleFactor: DPR,
  storageState: path.join(OUT, "state.json"),
});

// Read-only wallet standing in for the owner: reads work, anything that signs is refused.
await ctx.addInitScript(() => {
  if (!location.host.startsWith("localhost")) return;
  const owner = "0x3656ABd007AED9B9A572a63c58447044D69f8DAf";
  window.ethereum = {
    async request({ method }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [owner];
      if (method === "eth_chainId") return "0x18e8f";
      const e = new Error("User rejected the request."); e.code = 4001; throw e;
    },
    on() {}, removeListener() {},
  };
});

// A visible cursor with click ripples, and no scrollbars.
await ctx.addInitScript(() => {
  const install = () => {
    if (document.getElementById("__cur")) return;
    const st = document.createElement("style");
    st.textContent = `
      ::-webkit-scrollbar { display: none !important; }
      html { scrollbar-width: none !important; }
      #__cur { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
               transform: translate(-100px, -100px); will-change: transform; }
      #__cur svg { display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,.28)); }
      .__rip { position: fixed; z-index: 2147483646; pointer-events: none; width: 44px; height: 44px;
               margin: -22px 0 0 -22px; border-radius: 50%; border: 2.5px solid rgba(132,87,232,.85);
               background: rgba(132,87,232,.14); animation: __rip 520ms ease-out forwards; }
      @keyframes __rip { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.35); opacity: 0 } }`;
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "__cur";
    c.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5 L4 19.5 L8.6 15.2 L11.6 21.8 L14.4 20.6 L11.5 14.1 L17.8 14.1 Z" fill="#11131b" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(c);
    const last = JSON.parse(sessionStorage.getItem("__curpos") || "null");
    if (last) c.style.transform = `translate(${last[0]}px, ${last[1]}px)`;
    addEventListener("mousemove", (e) => {
      c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      sessionStorage.setItem("__curpos", JSON.stringify([e.clientX, e.clientY]));
    }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "__rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
});

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

// ── Screencast ───────────────────────────────────────────────────────────────
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const f = path.join(FRAMES, `${String(frames.length).padStart(6, "0")}.jpg`);
  fs.writeFileSync(f, Buffer.from(data, "base64"));
  frames.push({ file: f, t: metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
const startCast = () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

// ── Helpers ──────────────────────────────────────────────────────────────────
const marks = [];
const now = () => Date.now() / 1000;
const mark = (id, title) => { marks.push({ id, title, t: now() }); console.log("scene", id, title); };
const beat = (label) => { marks.push({ beat: label, t: now() }); };
const hold = (ms) => page.waitForTimeout(ms);
let cur = { x: 800, y: 450 };

async function moveTo(x, y, steps = 28) {
  await page.mouse.move(x, y, { steps });
  cur = { x, y };
}
async function moveToEl(sel, { dx = 0, dy = 0, steps = 28 } = {}) {
  const l = typeof sel === "string" ? page.locator(sel).first() : sel;
  await l.scrollIntoViewIfNeeded().catch(() => {});
  const bb = await l.boundingBox();
  if (!bb) throw new Error("no box for " + sel);
  await moveTo(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2 + dy, steps);
  return l;
}
async function clickEl(sel, opts) {
  await moveToEl(sel, opts);
  await hold(250);
  await page.mouse.down(); await hold(70); await page.mouse.up();
}
async function scrollTo(y, ms = 1400) {
  await page.evaluate(([y, ms]) => new Promise((r) => {
    const s = scrollY, d = y - s, t0 = performance.now();
    const f = (t) => {
      const k = Math.min((t - t0) / ms, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      scrollTo(0, s + d * e);
      k < 1 ? requestAnimationFrame(f) : r();
    };
    requestAnimationFrame(f);
  }), [y, ms]);
}
async function scrollToEl(sel, offset = 90, ms = 1400) {
  const y = await page.locator(sel).first().evaluate((el, off) => el.getBoundingClientRect().top + scrollY - off, offset);
  await scrollTo(Math.max(0, y), ms);
}

// ── Scenes ───────────────────────────────────────────────────────────────────
await page.goto(APP + "/");
await page.waitForTimeout(3500); // fonts, live data, arc animation
await moveTo(1180, 690, 1);
await startCast();
await hold(300);

mark("01-hook", "Landing hero: borrow against your loan book without moving it");
await hold(4800);
await moveTo(820, 745, 40);   // drift toward the live bridge product shot
await hold(4600);
await moveToEl(".bridge-pill", { steps: 30 });
beat("cursor on the Attestcoin proof between the two chains");
await hold(4600);

mark("02-live-metrics", "Live metrics and 0 bridges / 0 oracles / 0 multisigs / 1 proof");
await scrollToEl(".metrics-wrap", 120, 1600);
await hold(3200);
await moveToEl(".zero:last-child", { steps: 30 });
beat("0 bridges · 0 oracles · 0 multisigs · 1 proof");
await hold(2600);

mark("03-how-it-works", "How it works: escrow on Sepolia → Attestcoin proof → Creditcoin credit");
await scrollToEl("#how", 80, 1500);
await hold(1200);
for (const i of [0, 1, 2]) {
  await moveToEl(page.locator(".how-step h3").nth(i), { steps: 24 });
  beat(["step 1: escrow on Sepolia", "step 2: Attestcoin proves it", "step 3: funded on Creditcoin"][i]);
  await hold(2900);
}

mark("04-dashboard", "Borrower dashboard: portfolios found by wallet, offers ready to claim");
await clickEl(".mk-nav .btn-primary");
await page.waitForURL(/#\/app/);
await hold(2600);
await moveToEl(".kpi-hero", { steps: 26 });
await hold(2000);
await moveToEl(".att", { steps: 34 });   // live attestation lag from ChainInfo
beat("sidebar: live Attestcoin lag from the ChainInfo precompile");
await hold(3800);

mark("05-claim-preflight", "Portfolio 3001: proof fetched, verified by BlockProver, previewIngest — before signing");
await clickEl(page.locator(".action", { hasText: "3001" }));
await page.waitForURL(/#\/p\/3001/);
await hold(1500);
await moveToEl(".lifecycle-card", { steps: 22 });
await hold(1600);
await moveToEl(".checks", { steps: 24 });
await page.waitForSelector(".check.is-ok >> nth=2", { timeout: 30000 });
beat("all three pre-flight checks green");
await hold(4600);
await moveToEl("button.btn-xl", { steps: 22 }); // hover Claim — not clicked: it would consume the receipt
beat("hover Claim $400,000 (not clicked)");
await hold(2400);
await scrollToEl(".journey", 260, 1300);
beat("proof journey: Sepolia → Attestcoin → Creditcoin");
await hold(2600);

mark("06-active-line", "Portfolio 2000 via ⌘K: a real line opened from the proof, interest accruing per second");
await scrollTo(0, 700);
await moveToEl(".search-btn", { steps: 26 });
await hold(300);
await page.keyboard.press("Control+k");
beat("⌘K palette");
await hold(700);
await page.keyboard.type("2000", { delay: 140 });
await hold(900);
await page.keyboard.press("Enter");
await page.waitForURL(/#\/p\/2000/);
await hold(1600);
await moveToEl(".owed", { steps: 26 });
beat("principal + interest ticking at 8% APR");
await hold(3400);
await clickEl(page.locator(".seg button", { hasText: "Repay" }));
await hold(1600);
await moveToEl(".timeline", { steps: 28, dy: -60 });
beat("activity: line opened against the proof, drew, repaid, interest");
await hold(3000);

mark("07-verify", "Verify it yourself: your browser re-runs the proof against live Creditcoin");
await scrollTo(0, 600);
await clickEl("a.btn-secondary >> text=Verify proof");
await page.waitForURL(/#\/verify\/2000/);
await page.waitForSelector(".vstep.is-ok >> nth=4", { timeout: 30000 });
beat("all five verification steps green");
await hold(2200);
await scrollToEl(".vstep:nth-child(2)", 110, 1600);
await moveToEl(".vstep:nth-child(2) .vstep-title", { steps: 26 });
beat("proof fetched from the Attestcoin prover: height, Merkle path, continuity roots");
await hold(3000);
await scrollToEl(".vstep:nth-child(3)", 110, 1400);
await moveToEl(page.locator(".vstep:nth-child(3) .kv-row", { hasText: "Attested value" }), { steps: 26 });
beat("receipt decoded in the browser: owner, portfolio, $300,000");
await hold(3200);
await scrollToEl(".vstep:nth-child(4)", 110, 1400);
await moveToEl(page.locator(".vstep:nth-child(4) .kv-row", { hasText: "Result" }), { steps: 24 });
beat("BlockProver.verify() → true");
await hold(4000);
await moveToEl(page.locator(".vstep:nth-child(5) .kv-row", { hasText: "Reusable" }), { steps: 24 });
beat("receipt bound to the line, marked used on-chain");
await hold(2800);

mark("08-forge", "Try to lie: forge the attested value — Creditcoin rejects it; the genuine value passes");
await scrollToEl(".forge", 200, 1400);
await hold(1400);
await clickEl(".forge input");
await page.locator(".forge input").fill("");
await hold(300);
beat("typing a forged value: $3,000,000");
await page.keyboard.type("3000000", { delay: 120 });
await hold(500);
await clickEl(".forge .btn-danger");
await page.waitForSelector(".forge-result.bad", { timeout: 30000 });
beat("REJECTED by Creditcoin: Merkle proof validation failed");
await moveToEl(".forge-result", { steps: 20 });
await hold(4200);
await clickEl(".forge input");
await page.locator(".forge input").fill("");
await page.keyboard.type("300000", { delay: 120 });
await hold(400);
await clickEl(".forge .btn-danger");
await page.waitForSelector(".forge-result.ok", { timeout: 30000 });
beat("genuine $300,000 accepted");
await moveToEl(".forge-result", { steps: 20 });
await hold(3000);

mark("09-ledger-valuer", "Proof ledger: every position public and verifiable; independent valuation desk");
await clickEl(page.locator(".sb-link", { hasText: "Proof ledger" }));
await page.waitForURL(/#\/ledger/);
await hold(1800);
await moveToEl(page.locator("tbody tr").first(), { steps: 26 });
beat("ledger rows: every lock, every line, each with Verify");
await hold(2600);
await clickEl(page.locator(".sb-link", { hasText: "Valuation desk" }));
await page.waitForURL(/#\/valuer/);
await hold(900);
await clickEl(page.locator(".tabs button", { hasText: "All portfolios" }));
beat("valuation desk: independent valuers, freshness tracked");
await hold(2600);

mark("10-lend", "Lend: LPs earn what borrowers pay; 8% APR split 6% to LPs, 2% protocol — on-chain");
await clickEl(page.locator(".sb-link", { hasText: "Lend" }));
await page.waitForURL(/#\/lend/);
await hold(1800);
await moveToEl(".kpi-hero", { steps: 26 });
await hold(2800);
await moveToEl(".split-bar", { steps: 26 });
beat("split bar: LPs 6% · protocol 2%");
await hold(3600);

mark("11-code", "The contract: freshness and replay first, BlockProver.verifyAndEmit, collateral decoded from the proven receipt, bound to the claim");
await page.goto("file://" + path.resolve(OUT, "code.html"));
await page.waitForTimeout(1200);
await moveTo(760, 300, 20);
await hold(1800);
const SPOT = { s1: "① freshness + replay checks", s2: "② blockProver.verifyAndEmit", s3: "③ _decodeLock from the proven receipt", s4: "④ claim bound to proof → 80% credit" };
const spot = async (step, line, ms) => {
  await page.evaluate((s) => { document.body.className = "focus " + s; }, step);
  beat(SPOT[step]);
  const bb = await page.locator(`.ln.${step}`).first().boundingBox();
  if (bb) await moveTo(Math.min(bb.x + 620, 1400), bb.y + bb.height / 2, 26);
  await hold(ms);
};
await spot("s1", 0, 3600);
await spot("s2", 0, 4200);
await spot("s3", 0, 3600);
await spot("s4", 0, 4200);
await page.evaluate(() => { document.body.className = ""; });
await hold(900);

mark("12-close", "Close: your loan book is already collateral");
await page.goto(APP + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
await scrollToEl(".cta", 140, 10);
await moveTo(820, 520, 30);
await hold(4200);
mark("end", "end");

await cdp.send("Page.stopScreencast");
await hold(300);
fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify(frames));
fs.writeFileSync(path.join(OUT, "marks.json"), JSON.stringify(marks, null, 2));
console.log("frames", frames.length, "duration", (frames.at(-1).t - frames[0].t).toFixed(1), "s");
console.log(errors.join("\n") || "no page errors");
await b.close();
