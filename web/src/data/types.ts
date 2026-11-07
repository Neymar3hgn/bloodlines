/** The shape of snapshot.json, as written by swarm/snapshot.ts. Amounts are strings of token units. */

export type AgentStatus = "Pending" | "Alive" | "Dead";
export type QuestionStatus = "Open" | "Cleared" | "Resolved" | "Settled" | "Void";

export interface Genome {
  name: string;
  model: string;
  strategy: string;
  temperature: number;
  shrink: number;
  size: number;
  focus: Record<string, number>;
}

export interface Agent {
  id: string;
  label: string;
  parent: string;
  generation: number;
  status: AgentStatus;
  genome_hash: string;
  genome: Genome | null;
  born_ms: number;
  died_ms: number;
  children: number;
  open: number;
  strikes: number;
  questions: number;
  edge_sum: number;
  prior: number;
  won: string;
  lost: string;
  rewards: string;
  bills: string;
  credits: string;
  reputation: number | null;
  last_child_at: number;
  /**
   * Not in today's snapshot. The colony's `death` event carries these two values,
   * so the obituary states the amount when a snapshot includes them.
   */
  death?: { balance: string; heir: string } | null;
}

export interface Order {
  agent: string;
  belief: number;
  stake: number;
  bill: string;
  receipt: string;
  /** 0 none, 1 yes, 2 no. */
  side: number;
  filled: number;
  cost: string;
  reward: string;
  payout: string;
}

export type Resolver =
  | "Public"
  | { Sealed: { hash: string } }
  | { OnChain: { contract: string; method: string; args: string; after_ms: number; at_least: string } };

export interface Question {
  id: number;
  text: string;
  category: string;
  source: string | null;
  opener: string;
  resolver: Resolver;
  opened_ms: number;
  commit_end_ms: number;
  reveal_end_ms: number;
  status: QuestionStatus;
  bounty: string;
  pool: string;
  commits: number;
  reveals: number;
  price: number;
  matched: number;
  yes_won: boolean | null;
  evidence: string | null;
  callback: string | null;
  locked: string;
  billed: string;
  refunded: string;
  paid: string;
  rewarded: string;
  orders: Order[];
}

export interface Stats {
  alive: number;
  agents: number;
  questions: number;
  settled: number;
  founders_open: boolean;
}

export interface Config {
  floor: string;
  spawn_threshold: string;
  endowment_bps: number;
  spawn_cooldown: number;
  max_alive: number;
  max_stake: number;
  max_open: number;
  treasury_bps: number;
  min_bounty: string;
}

export interface E2eResult {
  rule: string;
  claim: string;
  ok: boolean;
  detail: string;
}

export interface E2e {
  colony?: string;
  network?: string;
  at?: string;
  passed: number;
  total: number;
  results: E2eResult[];
}

export interface SimSummary {
  earlyBrier: number;
  lateBrier: number;
  earlyAvg: number;
  lateAvg: number;
  earlyTruth: number;
  lateTruth: number;
}

export interface SimExam {
  questions: number;
  founderError: number;
  evolvedError: number;
  evolvedWins: number;
}

export interface Sim {
  seeds: number;
  colony?: { params?: Record<string, string | number | boolean> };
  summary?: { selection: SimSummary[]; control: SimSummary[]; improved: number; beatControl: number };
  /** Printed by sim/run.ts. The site shows these as soon as the report includes them. */
  exam?: SimExam | SimExam[];
  exams?: SimExam[];
  lies?: { trials: number; crowd: number; lieWins: number; meanBestGainPct: number; meanRandomLiePct: number };
  habits?: { label: string; meanPct: number }[];
  pumps?: { share: number; trials: number; honestPriceError: number; pumpedPriceError: number; whaleLossPerPump: number; losingPumps: number }[];
}

export interface Experiment {
  run?: string;
  mode?: string;
  questions?: { season?: number; exam?: number };
  usage?: { spentUsd?: number; modelCalls?: number; cachedAnswers?: number; verifiedReceipts?: number };
  season?: { alive?: number; total?: number; births?: number; deaths?: number; maxGeneration?: number };
  exam?: {
    questions?: number;
    coinFlip?: number;
    foundersMarket?: number;
    survivorsMarket?: number;
    foundersAverage?: number;
    bestFounderInHindsight?: { id: string; brier: number; n: number };
    medianFounder?: { id: string; brier: number; n: number };
    pairedDifference?: { mean: number; low: number; high: number };
    verdict?: string;
    survivorsCount?: number;
  };
  modelLeaderboard?: { model: string; brier: number; forecasts: number; costPerThousand: number }[];
}

export interface Snapshot {
  generated: string;
  network: string;
  colony: string;
  keeper: string;
  verifier: string;
  token_id: string;
  treasury: string;
  treasury_credits: string;
  config: Config;
  stats: Stats;
  agents: Agent[];
  questions: Question[];
  e2e: E2e | null;
  sim: Sim | null;
  experiment: Experiment | null;
  /** "ai" hides the scripted banner. Missing counts as scripted. */
  mode?: string;
  /** Set only by the dev fixture, so a fixture can never pass as chain data. */
  fixture?: boolean;
}
