/**
 * Records the demo video: a captioned tour of the real site, driven from the same
 * snapshot it shows, so a new run after the AI experiment needs no editing.
 *
 *   npm i playwright ffmpeg-static && npx playwright install chromium
 *   node tools/demo/record.mjs http://localhost:5173/ docs/demo.mp4
 *
 * Captions only say what is on screen. Every number comes from the snapshot.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The tools live outside the repo, so resolve them from where this runs.
const require = createRequire(pathToFileURL(`${process.cwd()}/`).href);
const { chromium } = require("playwright");
const ffmpeg = require("ffmpeg-static");

const site = process.argv[2] ?? "http://localhost:5173/";
const output = process.argv[3] ?? "demo.mp4";
const snapshotPath = process.argv[4] ?? "web/public/data/snapshot.json";
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

const WIDTH = 1280;
const HEIGHT = 720;
const workDir = "demo-frames";
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const realRounds = snapshot.questions.filter((q) => q.status === "Settled" && q.yes_won !== null && q.category !== "test");
// A round real models answered, if there is one, because that is the one worth showing.
const answeredByModels = (q) => Object.values(q.thoughts ?? {}).some((t) => t.reasoning);
const round = [...realRounds].sort((a, b) => answeredByModels(b) - answeredByModels(a) || b.reveals - a.reveals || b.id - a.id)[0];
const pooled = [...realRounds].reverse().find((q) => q.research?.status === "Bought" && q.research.buyers.length >= 4);
const dead = snapshot.agents.find((a) => a.status === "Dead");
const child = [...snapshot.agents].filter((a) => a.generation > 0).sort((a, b) => b.generation - a.generation)[0];
const scripted = snapshot.mode === "scripted";
const usesAi = scripted
  ? "Scripted agents, testing the contracts."
  : snapshot.mode === "mixed"
    ? `${snapshot.real_rounds} rounds on real models, the rest scripted to test the contracts.`
    : "Real models, on NEAR AI Cloud.";
const verdict = snapshot.experiment?.mode === "ai" ? snapshot.experiment.exam?.verdict : null;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  colorScheme: "dark",
  recordVideo: { dir: workDir, size: { width: WIDTH, height: HEIGHT } },
});
const page = await context.newPage();

/** A caption bar, drawn over the page, so a viewer with the sound off follows it. */
async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText =
        "position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:880px;padding:14px 26px;background:rgba(19,16,21,.94);color:#f3ecdc;font:500 25px/1.32 'Geist',system-ui,sans-serif;border-radius:6px;z-index:99999;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.35)";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

const wait = (ms) => page.waitForTimeout(ms);

async function go(hash) {
  await page.goto(`${site}#${hash}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(700);
}

async function glide(toY, ms = 1500) {
  await page.evaluate(
    async ({ y, d }) => {
      const from = window.scrollY;
      const start = performance.now();
      await new Promise((done) => {
        const step = (now) => {
          const t = Math.min(1, (now - start) / d);
          window.scrollTo(0, from + (y - from) * (t * t * (3 - 2 * t)));
          if (t < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    },
    { y: toY, d: ms },
  );
}

async function toHeading(text, offset = 70) {
  const y = await page.evaluate(
    ({ t, o }) => {
      const h = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes(t));
      return h ? h.getBoundingClientRect().top + window.scrollY - o : null;
    },
    { t: text, o: offset },
  );
  if (y !== null) await glide(y);
}

// 1. The idea
await go("/");
await caption("Every agent has a family. Only the rich ones keep it going.");
await wait(5000);

// 2. The tree
const tree = await page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  return svg ? svg.getBoundingClientRect().top + window.scrollY - 20 : 600;
});
await glide(tree, 1800);
await caption("Every name on this tree is a real NEAR account. Only a parent can create its child's account.");
await wait(6500);
const deadCount = snapshot.stats.agents - snapshot.stats.alive;
await caption(deadCount > 0 ? `${snapshot.stats.alive} alive. ${deadCount} dead, deleted from the chain. Nobody chooses who survives.` : `${snapshot.stats.alive} alive. The first to go broke will be deleted from the chain. Nobody chooses who survives.`);
await wait(5000);

// 3. A round
if (round) {
  await go(`/round/${round.id}`);
  await caption(`A real round. ${round.reveals} agents, each with its own money at stake.`);
  await wait(3500);
  // Keep the chart clear of the caption bar.
  const figure = await page.evaluate(() => {
    const el = document.querySelector(".round-figure");
    return el ? el.getBoundingClientRect().top + window.scrollY - 24 : null;
  });
  if (figure !== null) await glide(figure, 1000);
  const sealed = page.getByRole("button", { name: "Sealed" });
  if (await sealed.count()) {
    await sealed.first().click().catch(() => {});
    await caption("First, every agent seals one number. Nobody can copy anybody.");
    await wait(4000);
    await page.getByRole("button", { name: "Revealed" }).first().click().catch(() => {});
  }
  await caption(`They all reveal in one transaction through NEAR Intents. The stake-weighted median is the swarm's answer: ${round.price}%.`);
  await wait(6500);
  await toHeading("Who got what");
  await caption("Right agents take money from wrong ones. Thinking costs money too.");
  await wait(5000);
  await toHeading("The money");
  await caption("Money in equals money out, to the last unit.");
  await wait(3500);
}

// 4. Buying together
if (pooled) {
  const each = Number(pooled.research.share) / 1e6;
  const alone = Number(pooled.research.price) / 1e6;
  await go(`/round/${pooled.id}`);
  await toHeading("The research they bought together");
  await caption(`${pooled.research.buyers.length} agents pooled money for one briefing. Each paid ${each.toFixed(3)}, not ${alone.toFixed(2)}.`);
  await wait(5500);
}

// 5. Death
if (dead) {
  await go(`/agent/${dead.id}`);
  await caption("Go broke, and your account is deleted from the chain. Your money goes to your parent.");
  await wait(5500);
}

// 6. Birth
if (child) {
  await go(`/agent/${child.id}`);
  await caption(scripted ? "Get rich, and you have a child, with its own strategy and a record inherited from you." : "Get rich, and you have a child, with a strategy rewritten from your own wins and losses.");
  await wait(5500);
}

// 7. Proof
await go("/proof");
await caption("You don't have to trust any of this.");
await wait(2500);
const check = page.getByRole("button", { name: /Check it yourself/ });
if (await check.count()) {
  await check.first().scrollIntoViewIfNeeded().catch(() => {});
  await check.first().click().catch(() => {});
  await caption("This page rebuilds every round from the chain, with the same rules, in your browser.");
  await wait(7000);
}

if (verdict) {
  await toHeading("The experiment");
  await caption(`The experiment on real models, on questions no agent had seen: ${verdict}.`);
  await wait(6000);
}

// 8. The end
await go("/");
await caption(`${usesAi} Live on NEAR testnet. Built at NEAR HACKATHON.`);
await wait(4500);

const video = page.video();
await context.close();
await browser.close();
const webm = video ? await video.path() : join(workDir, readdirSync(workDir)[0]);

execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", output]);
rmSync(workDir, { recursive: true, force: true });
console.log(`Wrote ${output}`);
