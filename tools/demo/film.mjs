/**
 * Films the demo video from the real site. Each frame is drawn on the film's own clock
 * and captured one at a time, so the motion is smooth however busy the machine is.
 *
 * Run it from a folder that has playwright and ffmpeg-static installed, with the site up:
 *
 *   node <repo>/tools/demo/film.mjs <site url> <repo> <work folder> <out.mp4> [--only id,id] [--stills] [--mix]
 *
 * <work folder> holds narration.wav and timeline.json from assemble.py. Finished scenes
 * are kept there, so re-filming one scene is quick. --stills saves a few pictures of each
 * scene instead of filming it. --mix only puts the finished scenes and the voice together.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(pathToFileURL(`${process.cwd()}/`).href);
const { chromium } = require("playwright");
const ffmpeg = require("ffmpeg-static");

const [site, repo, work, output] = process.argv.slice(2);
const flag = (name) => process.argv.indexOf(`--${name}`);
const only = flag("only") > 0 ? new Set(process.argv[flag("only") + 1].split(",")) : null;
const stills = flag("stills") > 0;
const mixOnly = flag("mix") > 0;

const FPS = 30;
const CRF = 21;
const here = dirname(fileURLToPath(import.meta.url));
const timeline = JSON.parse(readFileSync(join(work, "timeline.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(join(repo, "web/public/data/snapshot.json"), "utf8"));
const label = (id) => id.split(".")[0];

/** Everything the film shows comes from the chain's snapshot, and has to agree with the words. */
function factsFromChain() {
  const sold = [...snapshot.questions].reverse().find((q) => q.category !== "test" && q.research?.status === "Bought" && q.research.sale?.winner);
  const child = [...snapshot.agents].filter((a) => a.generation > 0).sort((a, b) => b.born_ms - a.born_ms)[0];
  const offers = sold.research.sale.offers
    .filter((o) => o.ask !== null)
    .map((o) => ({ name: label(o.seller), cents: Number(o.ask) / 10_000 }))
    .sort((a, b) => b.cents - a.cents);
  const facts = {
    round: sold.id,
    sealed: sold.commits,
    price: sold.price,
    forecasters: sold.orders.map((o) => label(o.agent)).sort(),
    buyers: sold.research.buyers.map(label),
    offers,
    alive: snapshot.stats.alive,
    dead: snapshot.stats.agents - snapshot.stats.alive,
    child: child.id,
    childLabel: label(child.id),
    parentLabel: label(child.parent),
  };
  const agrees =
    facts.buyers.length === 10 &&
    offers.length === 5 &&
    offers[4].name === "tea" &&
    Math.round(offers[4].cents) === 1 &&
    facts.parentLabel === "sol" &&
    facts.alive === 18 &&
    facts.dead === 0 &&
    sold.yes_won === true &&
    /Real Madrid/.test(sold.text);
  if (!agrees) throw new Error(`the chain no longer matches the script: ${JSON.stringify(facts)}`);
  return facts;
}

const facts = factsFromChain();
const scenesDir = join(work, "scenes");
const stillsDir = join(work, "stills");
mkdirSync(scenesDir, { recursive: true });
mkdirSync(stillsDir, { recursive: true });

const browser = mixOnly ? null : await chromium.launch();
const page = mixOnly ? null : await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark", deviceScaleFactor: 1 })).newPage();
if (page) {
  page.on("pageerror", (e) => console.log("page error:", String(e).slice(0, 200)));
  await page.goto(`${site}#/`);
  await page.waitForSelector(".hero-tree svg", { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ path: join(here, "stage.js") });
  await page.evaluate(([t, f]) => window.F.init(t, f), [timeline, facts]);
}

async function drawAt(t) {
  await page.evaluate((x) => window.F.frame(x), t);
}

async function film(line, first, last, file) {
  const encoder = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", String(CRF), "-pix_fmt", "yuv420p", "-r", String(FPS), file], { stdio: ["pipe", "inherit", "inherit"] });
  for (let n = first; n < last; n++) {
    await drawAt(n / FPS);
    const shot = await page.screenshot({ type: "jpeg", quality: 94 });
    if (!encoder.stdin.write(shot)) await once(encoder.stdin, "drain");
  }
  encoder.stdin.end();
  await once(encoder, "close");
}

const parts = [];
for (let i = 0; i < timeline.lines.length; i++) {
  const line = timeline.lines[i];
  // Scene edges are whole frames, so nothing drifts against the voice.
  const first = i === 0 ? 0 : Math.round(line.start * FPS);
  const last = Math.round(line.end * FPS);
  const file = join(scenesDir, `${String(i).padStart(2, "0")}-${line.id}.mp4`);
  parts.push(file);
  if (mixOnly) continue;
  await page.evaluate((id) => window.F.setup(id), line.id);
  const wanted = !only || only.has(line.id);
  if (stills) {
    if (wanted) {
      for (const [k, share] of [0.12, 0.45, 0.72, 0.96].entries()) {
        await drawAt(line.start + (line.end - line.start) * share);
        await page.screenshot({ path: join(stillsDir, `${String(i).padStart(2, "0")}-${line.id}-${k}.jpg`), type: "jpeg", quality: 70 });
      }
    }
    await drawAt(line.end - 1 / FPS);
  } else if (wanted) {
    const began = Date.now();
    await film(line, first, last, file);
    console.log(`${line.id}: ${last - first} frames in ${Math.round((Date.now() - began) / 1000)}s`);
  } else {
    await drawAt(line.end - 1 / FPS);
  }
}
await browser?.close();

/** Measures first, then turns the whole track up or down by one amount, so a whisper stays a whisper. */
function evenLoudness() {
  const wav = join(work, "narration.wav");
  const base = "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=18";
  const { stderr } = spawnSync(ffmpeg, ["-hide_banner", "-i", wav, "-af", `${base}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
  const m = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1));
  return `[1:a]${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000[a]`;
}

if (!stills && parts.every((p) => existsSync(p))) {
  const list = join(work, "scenes.txt");
  writeFileSync(list, parts.map((p) => `file '${p.replaceAll("\\", "/")}'`).join("\n"));
  const silent = join(work, "picture.mp4");
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", silent, "-i", join(work, "narration.wav"), "-filter_complex", evenLoudness(), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]);
  console.log(`Wrote ${output}`);
}
