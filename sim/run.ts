/** Runs the scripted colony with no language model calls. Usage: node sim/run.ts [--seeds N]. The published numbers use 8 seeds. */
import { writeFileSync } from "node:fs";
import { blindLieAudit, lyingAudit, pumpAttack } from "./gaming.ts";
import { DEFAULTS, runColony, type Bucket } from "./world.ts";

const seedsArg = process.argv.indexOf("--seeds");
const seeds = seedsArg > 0 ? Number(process.argv[seedsArg + 1]) : 3;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = <T,>(xs: T[], g: (x: T) => number) => xs.reduce((t, x) => t + g(x), 0);
const f = (x: number, d = 4) => x.toFixed(d).padStart(d + 3);

function summarize(buckets: Bucket[]) {
  const third = Math.max(1, Math.floor(buckets.length / 3));
  return {
    earlyBrier: mean(buckets.slice(0, third).map((b) => b.brier)),
    lateBrier: mean(buckets.slice(-third).map((b) => b.brier)),
    earlyAvg: mean(buckets.slice(0, third).map((b) => b.avgBrier)),
    lateAvg: mean(buckets.slice(-third).map((b) => b.avgBrier)),
    earlyTruth: mean(buckets.slice(0, third).map((b) => b.truthError)),
    lateTruth: mean(buckets.slice(-third).map((b) => b.truthError)),
  };
}

const runs = [];
const controls = [];
for (let s = 1; s <= seeds; s++) {
  runs.push(runColony({ ...DEFAULTS, seed: s, selection: true }));
  controls.push(runColony({ ...DEFAULTS, seed: s, selection: false }));
}

const sel = runs.map((r) => summarize(r.buckets));
const ctl = controls.map((r) => summarize(r.buckets));

console.log(`Clade simulation: ${DEFAULTS.founders} founders, ${DEFAULTS.questions} questions, ${seeds} seeds, no model calls\n`);
console.log("One colony, seed 1:");
console.log(" questions   truth error   price score  alive  gen  births  deaths   noise   herd  confidence");
for (const b of runs[0].buckets) {
  console.log(
    `${String(b.from).padStart(9)}   ${f(b.truthError)}   ${f(b.brier)}  ${String(b.alive).padStart(5)} ${String(b.maxGen).padStart(4)} ${String(b.births).padStart(7)} ${String(b.deaths).padStart(7)}  ${f(b.meanNoise, 2)} ${f(b.meanHerd, 2)}  ${f(b.meanConfidence, 2)}`,
  );
}

const improved = sel.filter((x) => x.lateTruth < x.earlyTruth).length;
const beatControl = sel.filter((x, i) => x.lateTruth < ctl[i].lateTruth).length;
const exams = runs.map((r) => r.exam);
const examWon = exams.filter((e) => e.evolvedError < e.founderError).length;
console.log("\nAverage over all seeds (squared error against the hidden truth, lower is better):");
console.log(`  With selection, first third : ${f(mean(sel.map((x) => x.earlyTruth)))}`);
console.log(`  With selection, last third  : ${f(mean(sel.map((x) => x.lateTruth)))}`);
console.log(`  Control, last third         : ${f(mean(ctl.map((x) => x.lateTruth)))}`);
console.log(`  Seeds that improved over time     : ${improved} of ${seeds}`);
console.log(`  Seeds that beat their control     : ${beatControl} of ${seeds}`);
console.log(`\nThe exam: founders and survivors answer the same ${exams[0].questions} new questions`);
console.log(`  Founders' error  : ${f(mean(exams.map((e) => e.founderError)))}`);
console.log(`  Survivors' error : ${f(mean(exams.map((e) => e.evolvedError)))}`);
console.log(`  Error reduced by : ${(100 * (1 - sum(exams, (e) => e.evolvedError) / sum(exams, (e) => e.founderError))).toFixed(1)}%`);
console.log(`  Seeds won        : ${examWon} of ${seeds}`);
console.log("");
console.log(`  Money conservation errors         : ${runs.reduce((t, r) => t + r.conservationErrors, 0)}`);
const deaths = runs.reduce((t, r) => t + r.agents.filter((a) => a.died !== null).length, 0);
const births = runs.reduce((t, r) => t + r.agents.filter((a) => a.parent !== null).length, 0);
console.log(`  Births and deaths                 : ${births} births, ${deaths} deaths`);

const lies = lyingAudit(400, 24, 11);
console.log(`\nCan an agent gain by lying about its belief? (${lies.trials} books, ${lies.crowd} agents, every possible lie tried)`);
console.log(`  Books where some lie beat the truth : ${lies.lieWins} of ${lies.trials}`);
console.log(`  Mean gain from the best possible lie: ${lies.meanBestGainPct.toFixed(3)}% of stake`);
console.log(`  Mean result of a typical lie        : ${lies.meanRandomLiePct.toFixed(2)}% of stake`);
const habits = blindLieAudit(4000, 24, 12);
console.log("\nOrders are sealed, so a real liar can only use a fixed habit:");
for (const h of habits) console.log(`  ${h.label.padEnd(26)}: ${h.meanPct >= 0 ? "+" : ""}${h.meanPct.toFixed(3)}% of stake`);

const pumps = [0.1, 0.25, 0.5, 1].map((share) => ({ share, ...pumpAttack(2000, 24, share, 5) }));
console.log("\nCan a whale pump the answer? (it seals 99 on questions whose true chance is low)");
console.log(" whale size   price error before   after   whale loss per pump   pumps that lose money");
for (const p of pumps) {
  console.log(
    `${(p.share * 100).toFixed(0).padStart(9)}%   ${p.honestPriceError.toFixed(2).padStart(18)}   ${p.pumpedPriceError.toFixed(2).padStart(5)}   ${p.whaleLossPerPump.toFixed(1).padStart(19)}   ${(p.losingPumps * 100).toFixed(1).padStart(20)}%`,
  );
}

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
// A short run prints its numbers but leaves the published report alone.
if (seeds >= 8) writeFileSync(
  "data/sim-report.json",
  JSON.stringify(
    {
      seeds,
      colony: { buckets: runs[0].buckets, params: runs[0].params },
      control: { buckets: controls[0].buckets },
      summary: { selection: sel, control: ctl, improved, beatControl },
      exams: { questions: exams[0].questions, founderError: mean(exams.map((e) => e.founderError)), evolvedError: mean(exams.map((e) => e.evolvedError)), wins: examWon, seeds },
      lies,
      habits,
      pumps,
    },
    replacer,
    1,
  ),
);
console.log(seeds >= 8 ? "\nWrote data/sim-report.json" : "\nFor the published numbers, run: npm run sim -- --seeds 8");
