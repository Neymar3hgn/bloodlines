//! The Clade colony. Implements RULES.md.
//!
//! Money enters through the NEAR Intents contract: an asker's bounty or an
//! agent's reveal arrives as a signed `transfer` intent that calls
//! `mt_on_transfer` here. If a reveal is invalid this contract panics, and the
//! Intents contract automatically refunds the sender.

use clade_core as rules;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Allowance, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue, PublicKey,
};

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const NO_DEPOSIT: NearToken = NearToken::from_yoctonear(0);
const GAS_VIEW: Gas = Gas::from_tgas(5);
const GAS_TRANSFER: Gas = Gas::from_tgas(12);
const GAS_ON_SWEPT: Gas = Gas::from_tgas(4);
const GAS_NEW_AGENT: Gas = Gas::from_tgas(15);
const GAS_CHILD: Gas = Gas::from_tgas(80);
const GAS_BIRTH_DONE: Gas = Gas::from_tgas(10);
const GAS_DIE: Gas = Gas::from_tgas(70);
const GAS_SPAWN_CHECK: Gas = Gas::from_tgas(110);
const GAS_REAP_CHECK: Gas = Gas::from_tgas(85);
const GAS_ANSWER: Gas = Gas::from_tgas(10);
const GAS_ORACLE: Gas = Gas::from_tgas(30);
const GAS_ORACLE_DONE: Gas = Gas::from_tgas(10);

const AGENT_METHODS: &str = "commit,spawn";
const MAX_QUESTION_LEN: usize = 400;
const MAX_CATEGORY_LEN: usize = 32;
const MAX_SOURCE_LEN: usize = 256;
const MAX_GENOME_LEN: usize = 4_000;
const MAX_METHOD_LEN: usize = 64;
const MAX_ORACLE_ARGS_LEN: usize = 512;
const MAX_RECEIPT_LEN: usize = 64;
const MAX_WINDOW_SECS: u64 = 7 * 24 * 3600;
const MAX_ACCOUNT_LEN: usize = 64;
const STRIKES_TO_REAP: u8 = 3;
/// R26: keeps `close_pool` and `refund_pool` well inside one transaction's gas.
const MAX_BUYERS: usize = 64;

#[ext_contract(ext_verifier)]
#[allow(dead_code)]
trait Verifier {
    fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    );
    fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128;
}


/// R22: a contract that asked a question implements this to receive the answer.
#[ext_contract(ext_asker)]
#[allow(dead_code)]
trait Asker {
    fn on_clade_answer(&mut self, question_id: u64, price: u8);
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Agents,
    Questions,
    Commits,
    Committers,
    Orders,
    Claimable,
    Pools,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    pub owner: AccountId,
    pub keeper: AccountId,
    pub verifier: AccountId,
    pub token_id: String,
    pub treasury: AccountId,
    /// The account holding the global agent contract.
    pub agent_code: AccountId,
    /// Makes on-chain reads, so an asker's chosen call never comes from the colony.
    pub reader: AccountId,
    /// R25: how long after its window a question can wait for a result.
    pub max_wait_secs: u64,
    pub floor: U128,
    pub spawn_threshold: U128,
    pub endowment_bps: u32,
    pub spawn_cooldown: u64,
    pub max_alive: u32,
    pub max_stake: u64,
    pub max_open: u32,
    pub treasury_bps: u32,
    pub min_bounty: U128,
    /// Native NEAR the colony gives each new agent for storage and gas.
    pub agent_near: NearToken,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Status {
    Pending,
    Alive,
    Dead,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct AgentRec {
    pub parent: AccountId,
    pub generation: u32,
    pub status: Status,
    /// Hex sha256 of the agent's genome text.
    pub genome_hash: String,
    pub born_ms: u64,
    pub died_ms: u64,
    pub children: u32,
    pub open: u32,
    pub strikes: u8,
    pub questions: u64,
    pub edge_sum: i64,
    /// Reputation inherited from the parent at birth (R15).
    pub prior: i64,
    pub won: U128,
    pub lost: U128,
    pub rewards: U128,
    pub bills: U128,
    /// `settled_total` at the time of the agent's last child (R12).
    pub last_child_at: u64,
    /// R14: what the agent left, and to whom.
    pub final_credits: U128,
    pub heir: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub enum Resolver {
    /// R21: the answer's hash is public before anyone bids.
    Sealed { hash: String },
    /// R21: the keeper posts the result and a source link.
    Public,
    /// R21: after `after_ms`, call `contract.method(args)`; YES if the numeric
    /// result is at least `at_least`. Nobody has to be trusted.
    OnChain { contract: AccountId, method: String, args: String, after_ms: u64, at_least: U128 },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum QStatus {
    Open,
    Cleared,
    Resolved,
    Settled,
    Void,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Question {
    pub id: u64,
    pub text: String,
    pub category: String,
    pub source: Option<String>,
    pub opener: AccountId,
    pub resolver: Resolver,
    pub opened_ms: u64,
    pub commit_end_ms: u64,
    pub reveal_end_ms: u64,
    /// R25: after this, anyone can void the question.
    pub expires_ms: u64,
    pub status: QStatus,
    pub bounty: U128,
    pub pool: U128,
    pub commits: u32,
    pub reveals: u32,
    pub price: u8,
    pub matched: u64,
    pub yes_won: Option<bool>,
    pub evidence: Option<String>,
    pub callback: Option<AccountId>,
    pub cursor: u32,
    pub total_points: U128,
    pub rewarded: U128,
    pub locked: U128,
    pub billed: U128,
    pub refunded: U128,
    pub paid: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct OrderRec {
    pub agent: AccountId,
    pub belief: u8,
    pub stake: u64,
    pub bill: U128,
    /// Hash of the model answer this forecast came from.
    pub receipt: String,
    pub side: u8, // 0 none, 1 yes, 2 no
    pub filled: u64,
    pub cost: U128,
    pub reward: U128,
    pub payout: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PoolStatus {
    /// Agents can join.
    Open,
    /// Enough agents joined, and the shares are held until the briefing arrives.
    Closed,
    /// R28: the briefing's hash is on chain and the shares were paid.
    Bought,
    /// R27: too few agents joined, so everyone got their pledge back.
    Failed,
    /// R28: no briefing arrived in time, so everyone got their money back.
    Refunded,
}

/// R26: agents buying a research briefing together.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Pool {
    pub q: u64,
    pub price: U128,
    pub min_buyers: u32,
    /// What each buyer pays to join: `price / min_buyers`, rounded up.
    pub pledge: U128,
    pub end_ms: u64,
    pub buyers: Vec<AccountId>,
    /// R27: what each buyer really pays, set when the pool closes.
    pub share: U128,
    /// Money the colony is still holding for this pool.
    pub held: U128,
    pub status: PoolStatus,
    /// R28: hex sha256 of the briefing.
    pub briefing_hash: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub struct PoolAsk {
    pub price: U128,
    pub min_buyers: u32,
    /// How long agents have to join. The commit window starts after it.
    pub secs: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub struct AskMsg {
    pub text: String,
    pub category: String,
    pub source: Option<String>,
    pub resolver: Resolver,
    pub commit_secs: u64,
    pub reveal_secs: u64,
    /// R25: how long to wait for a result. Zero or anything over the colony's
    /// `max_wait_secs` means `max_wait_secs`.
    #[serde(default)]
    pub wait_secs: u64,
    pub callback: Option<AccountId>,
    /// R26: offer a shared research briefing on this question.
    #[serde(default)]
    pub pool: Option<PoolAsk>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub struct RevealMsg {
    pub q: u64,
    pub belief: u8,
    pub stake: u64,
    pub salt: String,
    pub bill: U128,
    pub receipt: String,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum Msg {
    Ask(AskMsg),
    Reveal(RevealMsg),
    Join { q: u64 },
}

/// R12: a parent signs this as an intent, so a relayer can pay for the birth.
#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum AuthMsg {
    Spawn { label: String, public_key: PublicKey, genome: String },
}

#[near(serializers = [json])]
pub struct Stats {
    pub alive: u32,
    pub agents: u32,
    pub questions: u64,
    pub settled: u64,
    pub founders_open: bool,
}

#[near(serializers = [json])]
pub struct Answer {
    pub id: u64,
    pub text: String,
    pub price: u8,
    pub reveals: u32,
    pub status: QStatus,
    pub yes_won: Option<bool>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Colony {
    config: Config,
    agents: IterableMap<AccountId, AgentRec>,
    alive: u32,
    questions: Vector<Question>,
    commits: LookupMap<(u64, AccountId), [u8; 32]>,
    committers: LookupMap<(u64, u32), AccountId>,
    orders: LookupMap<(u64, u32), OrderRec>,
    claimable: LookupMap<AccountId, u128>,
    settled_total: u64,
    founders_open: bool,
    pools: LookupMap<u64, Pool>,
}

/// The colony's state before research pools, so a live colony can be upgraded.
#[near(serializers = [borsh])]
struct ColonyV1 {
    config: Config,
    agents: IterableMap<AccountId, AgentRec>,
    alive: u32,
    questions: Vector<Question>,
    commits: LookupMap<(u64, AccountId), [u8; 32]>,
    committers: LookupMap<(u64, u32), AccountId>,
    orders: LookupMap<(u64, u32), OrderRec>,
    claimable: LookupMap<AccountId, u128>,
    settled_total: u64,
    founders_open: bool,
}

fn event(name: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "clade", "version": "1.0.0", "event": name, "data": [data]})
    ));
}

fn hex(bytes: &[u8]) -> String {
    const CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(CHARS[(b >> 4) as usize] as char);
        out.push(CHARS[(b & 15) as usize] as char);
    }
    out
}

/// R6: the hash an agent commits to.
pub fn commit_hash(q: u64, agent: &AccountId, belief: u8, stake: u64, salt: &str) -> [u8; 32] {
    let text = format!("{q}:{agent}:{belief}:{stake}:{salt}");
    env::sha256_array(text.as_bytes())
}

#[near]
impl Colony {
    #[init]
    pub fn new(config: Config) -> Self {
        require!(config.endowment_bps <= 10_000 && config.treasury_bps <= 10_000, "bad basis points");
        Self {
            config,
            agents: IterableMap::new(Key::Agents),
            alive: 0,
            questions: Vector::new(Key::Questions),
            commits: LookupMap::new(Key::Commits),
            committers: LookupMap::new(Key::Committers),
            orders: LookupMap::new(Key::Orders),
            claimable: LookupMap::new(Key::Claimable),
            settled_total: 0,
            founders_open: true,
            pools: LookupMap::new(Key::Pools),
        }
    }

    /// Adds research pools to a colony deployed before them.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: ColonyV1 = env::state_read().unwrap_or_else(|| env::panic_str("nothing to migrate"));
        Self {
            config: old.config,
            agents: old.agents,
            alive: old.alive,
            questions: old.questions,
            commits: old.commits,
            committers: old.committers,
            orders: old.orders,
            claimable: old.claimable,
            settled_total: old.settled_total,
            founders_open: old.founders_open,
            pools: LookupMap::new(Key::Pools),
        }
    }

    // ---------- Agents ----------

    /// R2: founders are children of the colony.
    pub fn add_founder(&mut self, label: String, public_key: PublicKey, genome: String) -> Promise {
        self.only_owner();
        require!(self.founders_open, "the season has started");
        require!(genome.len() <= MAX_GENOME_LEN, "genome is too long");
        self.require_room();
        let id = self.child_id(&label, &env::current_account_id());
        require!(!self.agents.contains_key(&id), "name is taken");
        let genome_hash = hex(&env::sha256(genome.as_bytes()));
        self.insert_agent(&id, env::current_account_id(), 0, genome_hash.clone(), 0);
        event("birth", json!({"agent": id, "parent": env::current_account_id(), "generation": 0, "genome_hash": genome_hash, "genome": genome}));

        // The agent contract reads newline-separated text. See contracts/agent.
        let args = format!(
            "{}\n{}\n{}\n{}\n{}",
            env::current_account_id(),
            self.config.verifier,
            self.config.token_id,
            self.config.agent_code,
            String::from(&public_key),
        )
        .into_bytes();
        Promise::new(id.clone())
            .create_account()
            .transfer(self.config.agent_near)
            .use_global_contract_by_account_id(self.config.agent_code.clone())
            .function_call("new".to_string(), args, NO_DEPOSIT, GAS_NEW_AGENT)
            .add_access_key_allowance(public_key, Allowance::Unlimited, env::current_account_id(), AGENT_METHODS.to_string())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_BIRTH_DONE).on_birth(id, None))
    }

    /// R2: closes the founder list for good.
    pub fn close_founders(&mut self) {
        self.only_owner();
        self.founders_open = false;
    }

    /// R12: an agent asks to have a child, paying its own gas.
    pub fn spawn(&mut self, label: String, public_key: PublicKey, genome: String) -> Promise {
        self.internal_spawn(env::predecessor_account_id(), label, public_key, genome)
    }

    /// R12: the same request as a signed intent. The Intents contract has checked
    /// the signature, so `signer_id` really is the parent and a relayer pays the
    /// gas. Agents hold almost no NEAR, so this is how they normally reproduce.
    #[payable]
    pub fn on_auth(&mut self, signer_id: AccountId, msg: String) -> Promise {
        require!(env::predecessor_account_id() == self.config.verifier, "only the Intents contract can authorize");
        match serde_json::from_str::<AuthMsg>(&msg).unwrap_or_else(|_| env::panic_str("bad message")) {
            AuthMsg::Spawn { label, public_key, genome } => self.internal_spawn(signer_id, label, public_key, genome),
        }
    }

    #[private]
    pub fn on_spawn_balance(
        &mut self,
        parent: AccountId,
        child: AccountId,
        label: String,
        public_key: PublicKey,
        genome: String,
        #[callback_result] balance: Result<U128, PromiseError>,
    ) -> Promise {
        let balance = balance.map(|b| b.0).unwrap_or(0);
        require!(balance >= self.config.spawn_threshold.0, "balance is below the spawn threshold");
        self.require_room();
        let rec = self.agent(&parent);
        // The balance read was asynchronous, so check everything again: two
        // requests could otherwise pass the first check together.
        self.require_can_spawn(&rec, &child);
        let credits = balance * self.config.endowment_bps as u128 / 10_000;
        let genome_hash = hex(&env::sha256(genome.as_bytes()));
        let prior = self.reputation_of(&rec);
        self.insert_agent(&child, parent.clone(), rec.generation + 1, genome_hash.clone(), prior);
        let mut updated = rec.clone();
        updated.children += 1;
        updated.last_child_at = self.settled_total;
        self.agents.insert(parent.clone(), updated);
        event("birth", json!({
            "agent": child, "parent": parent, "generation": rec.generation + 1,
            "genome_hash": genome_hash, "genome": genome, "credits": U128(credits), "prior": prior,
        }));
        let args = format!("{label}\n{}\n{}\n{credits}", hex(public_key.as_bytes()), String::from(&public_key)).into_bytes();
        Promise::new(parent.clone())
            .function_call("create_child".to_string(), args, self.config.agent_near, GAS_CHILD)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_BIRTH_DONE).on_birth(child, Some(parent)))
    }

    /// Marks a birth complete, or cancels it if the account could not be made.
    #[private]
    pub fn on_birth(&mut self, id: AccountId, parent: Option<AccountId>, #[callback_result] done: Result<(), PromiseError>) {
        let mut rec = self.agent(&id);
        if done.is_ok() {
            rec.status = Status::Alive;
            self.agents.insert(id, rec);
        } else {
            self.alive -= 1;
            self.agents.remove(&id);
            if let Some(p) = parent {
                let mut pr = self.agent(&p);
                pr.children = pr.children.saturating_sub(1);
                self.agents.insert(p, pr);
            }
            event("birth_failed", json!({"agent": id}));
        }
    }

    /// R13: anyone may reap an agent that is broke or has three strikes.
    pub fn reap(&mut self, agent: AccountId) -> Promise {
        let rec = self.agent(&agent);
        require!(rec.status == Status::Alive, "agent is not alive");
        require!(rec.open == 0, "agent has open positions");
        require!(self.claimable_of(&agent) == 0, "agent has unswept money");
        ext_verifier::ext(self.config.verifier.clone())
            .with_static_gas(GAS_VIEW)
            .mt_balance_of(agent.clone(), self.config.token_id.clone())
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_REAP_CHECK).on_reap_balance(agent))
    }

    #[private]
    pub fn on_reap_balance(&mut self, agent: AccountId, #[callback_result] balance: Result<U128, PromiseError>) -> Promise {
        let balance = balance.unwrap_or_else(|_| env::panic_str("could not read the balance")).0;
        let mut rec = self.agent(&agent);
        require!(rec.status == Status::Alive, "agent is already dead");
        // The balance read was asynchronous, so the agent may have traded since.
        require!(rec.open == 0, "agent has open positions");
        require!(self.claimable_of(&agent) == 0, "agent has unswept money");
        require!(
            balance < self.config.floor.0 || rec.strikes >= STRIKES_TO_REAP,
            "agent is solvent and has no strikes"
        );
        let heir = self.nearest_living(&agent);
        let (credit_heir, near_heir) = match heir {
            Some(h) => (h.clone(), h),
            None => (self.config.treasury.clone(), env::current_account_id()),
        };
        rec.status = Status::Dead;
        rec.died_ms = env::block_timestamp_ms();
        rec.final_credits = U128(balance);
        rec.heir = Some(credit_heir.clone());
        self.agents.insert(agent.clone(), rec);
        self.alive -= 1;
        event("death", json!({"agent": agent, "balance": U128(balance), "heir": credit_heir}));
        Promise::new(agent).function_call("die".to_string(), format!("{credit_heir}\n{near_heir}").into_bytes(), NO_DEPOSIT, GAS_DIE)
    }

    // ---------- Rounds ----------

    /// R6: one sealed commit per agent per question.
    pub fn commit(&mut self, q: u64, hash: String) {
        let agent = env::predecessor_account_id();
        let rec = self.agent(&agent);
        require!(rec.status == Status::Alive, "agent is not alive");
        let mut question = self.question(q);
        require!(question.status == QStatus::Open, "question is not open");
        require!(env::block_timestamp_ms() < question.commit_end_ms, "the commit window is closed");
        let bytes = parse_hash(&hash);
        let key = (q, agent.clone());
        require!(!self.commits.contains_key(&key), "already committed");
        self.commits.insert(key, bytes);
        self.committers.insert((q, question.commits), agent.clone());
        question.commits += 1;
        self.questions.replace(q as u32, question);
        event("commit", json!({"q": q, "agent": agent}));
    }

    /// Money arrives here from the Intents contract: a bounty or a reveal.
    /// Panicking makes the Intents contract refund the sender in full.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        let _ = previous_owner_ids;
        require!(env::predecessor_account_id() == self.config.verifier, "only the Intents contract can pay in");
        require!(token_ids.len() == 1 && token_ids[0] == self.config.token_id, "wrong token");
        let amount = amounts[0].0;
        match serde_json::from_str::<Msg>(&msg).unwrap_or_else(|_| env::panic_str("bad message")) {
            Msg::Ask(ask) => self.handle_ask(sender_id, amount, ask),
            Msg::Reveal(reveal) => self.handle_reveal(sender_id, amount, reveal),
            Msg::Join { q } => self.handle_join(sender_id, amount, q),
        }
        PromiseOrValue::Value(vec![U128(0)])
    }

    /// R9-R11: clears a round. Anyone can call this once the reveal window ends,
    /// or as soon as every committed agent has revealed.
    pub fn clear(&mut self, q: u64) {
        let mut question = self.question(q);
        require!(question.status == QStatus::Open, "question is not open");
        let now = env::block_timestamp_ms();
        let everyone_in = question.commits > 0 && question.reveals == question.commits && now >= question.commit_end_ms;
        require!(now >= question.reveal_end_ms || everyone_in, "the reveal window is still open");

        // R8: a commit with no reveal is a strike.
        for i in 0..question.commits {
            if let Some(agent) = self.committers.remove(&(q, i)) {
                if self.commits.remove(&(q, agent.clone())).is_some() {
                    let mut rec = self.agent(&agent);
                    rec.strikes = rec.strikes.saturating_add(1);
                    self.agents.insert(agent.clone(), rec);
                    event("strike", json!({"q": q, "agent": agent}));
                }
            }
        }

        if question.reveals == 0 {
            // R9: nothing to clear, so the bounty goes back to the asker.
            question.status = QStatus::Void;
            self.credit(&question.opener.clone(), question.bounty.0);
            self.questions.replace(q as u32, question);
            event("void", json!({"q": q}));
            return;
        }

        let cut = question.bounty.0 * self.config.treasury_bps as u128 / 10_000;
        question.pool = U128(question.bounty.0 - cut);
        self.credit(&self.config.treasury.clone(), cut);

        let mut book: Vec<OrderRec> = (0..question.reveals)
            .map(|i| self.orders.get(&(q, i)).cloned().unwrap_or_else(|| env::panic_str("missing order")))
            .collect();
        book.sort_by(|a, b| a.agent.cmp(&b.agent));
        let cores: Vec<rules::Order> = book.iter().map(|o| rules::Order { belief: o.belief, stake: o.stake }).collect();
        let cleared = rules::clear(&cores);
        question.price = cleared.price;
        question.matched = cleared.matched;
        let mut refunded = 0u128;
        for (i, (order, fill)) in book.iter_mut().zip(cleared.fills.iter()).enumerate() {
            order.filled = fill.filled;
            order.cost = U128(fill.cost);
            order.side = match fill.side {
                rules::Side::None => 0,
                rules::Side::Yes => 1,
                rules::Side::No => 2,
            };
            refunded += fill.refund;
            let agent = order.agent.clone();
            self.credit(&agent, fill.refund);
            self.orders.insert((q, i as u32), order.clone());
        }
        question.refunded = U128(refunded);
        question.status = QStatus::Cleared;
        let price = question.price;
        let callback = question.callback.clone();
        event("clear", json!({"q": q, "price": price, "matched": question.matched, "reveals": question.reveals}));
        self.questions.replace(q as u32, question);
        // R22: tell the contract that asked.
        if let Some(cb) = callback {
            ext_asker::ext(cb).with_static_gas(GAS_ANSWER).on_clade_answer(q, price).detach();
        }
    }

    /// R21: a sealed answer can be opened by anyone, once.
    pub fn resolve_sealed(&mut self, q: u64, yes: bool, salt: String) {
        let question = self.question(q);
        let Resolver::Sealed { hash } = &question.resolver else { env::panic_str("not a sealed question") };
        let want = hex(&env::sha256(format!("{}:{salt}", if yes { "yes" } else { "no" }).as_bytes()));
        require!(*hash == want, "the answer does not match the seal");
        self.finish_resolution(q, yes, None);
    }

    /// R21: the keeper posts a public result with a source link.
    pub fn resolve_public(&mut self, q: u64, yes: bool, evidence: String) {
        require!(env::predecessor_account_id() == self.config.keeper, "only the keeper");
        require!(matches!(self.question(q).resolver, Resolver::Public), "not a public question");
        self.finish_resolution(q, yes, Some(evidence));
    }

    /// R21: an on-chain question resolves itself by reading a NEAR contract.
    pub fn resolve_onchain(&mut self, q: u64) -> Promise {
        let question = self.question(q);
        require!(question.status == QStatus::Cleared, "question is not cleared");
        let Resolver::OnChain { contract, method, args, after_ms, .. } = question.resolver else {
            env::panic_str("not an on-chain question")
        };
        require!(env::block_timestamp_ms() >= after_ms, "too early to resolve");
        // The asker chose this contract and method, so the call must not come
        // from the colony, which agents obey. The reader has no authority.
        Promise::new(self.config.reader.clone())
            .function_call("read".to_string(), format!("{contract}\n{method}\n{args}").into_bytes(), NO_DEPOSIT, GAS_ORACLE)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ORACLE_DONE).on_oracle(q))
    }

    #[private]
    pub fn on_oracle(&mut self, q: u64, #[callback_result] value: Result<Value, PromiseError>) {
        let value = value.unwrap_or_else(|_| env::panic_str("the on-chain read failed"));
        let number: u128 = match &value {
            Value::String(s) => s.parse().unwrap_or_else(|_| env::panic_str("result is not a number")),
            Value::Number(n) => n.as_u64().unwrap_or_else(|| env::panic_str("result is not a number")) as u128,
            _ => env::panic_str("result is not a number"),
        };
        let Resolver::OnChain { at_least, .. } = self.question(q).resolver else { env::panic_str("not on-chain") };
        self.finish_resolution(q, number >= at_least.0, Some(format!("on-chain value {number}")));
    }

    /// The keeper can void a question whose source vanished. Everyone gets their
    /// cost back, and the asker gets the bounty back.
    pub fn void_question(&mut self, q: u64, evidence: String) {
        require!(env::predecessor_account_id() == self.config.keeper, "only the keeper");
        require!(evidence.len() <= MAX_SOURCE_LEN, "evidence is too long");
        self.finish_void(q, evidence);
    }

    /// R25: if a result never comes, anyone can void the question, so a missing
    /// keeper can never lock an agent's money.
    pub fn expire(&mut self, q: u64) {
        let question = self.question(q);
        require!(env::block_timestamp_ms() >= question.expires_ms, "the question has not expired");
        self.finish_void(q, "expired with no result".to_string());
    }

    /// R17, R18, R20: pays out a resolved question, `limit` orders at a time.
    pub fn settle(&mut self, q: u64, limit: u32) {
        let mut question = self.question(q);
        require!(question.status == QStatus::Resolved, "question is not resolved");
        let outcome = question.yes_won;
        if question.cursor == 0 {
            if let Some(yes) = outcome {
                let mut total = 0u128;
                for i in 0..question.reveals {
                    let o = self.orders.get(&(q, i)).unwrap_or_else(|| env::panic_str("missing order"));
                    total += rules::points_of(o.belief, o.stake, question.price, yes);
                }
                question.total_points = U128(total);
            }
        }
        let end = core::cmp::min(question.cursor.saturating_add(limit), question.reveals);
        for i in question.cursor..end {
            let mut order = self.orders.get(&(q, i)).cloned().unwrap_or_else(|| env::panic_str("missing order"));
            let mut rec = self.agent(&order.agent);
            rec.open = rec.open.saturating_sub(1);
            match outcome {
                Some(yes) => {
                    let fill = rules::Fill {
                        side: match order.side {
                            1 => rules::Side::Yes,
                            2 => rules::Side::No,
                            _ => rules::Side::None,
                        },
                        filled: order.filled,
                        lock: 0,
                        cost: order.cost.0,
                        refund: 0,
                    };
                    let payout = rules::payout_of(&fill, yes);
                    let points = rules::points_of(order.belief, order.stake, question.price, yes);
                    let reward = rules::reward_of(question.pool.0, points, question.total_points.0);
                    let edge = rules::edge_of(order.belief, question.price, yes);
                    rec.questions += 1;
                    rec.edge_sum += edge;
                    if payout >= order.cost.0 {
                        rec.won = U128(rec.won.0 + (payout - order.cost.0));
                    } else {
                        rec.lost = U128(rec.lost.0 + (order.cost.0 - payout));
                    }
                    rec.rewards = U128(rec.rewards.0 + reward);
                    order.payout = U128(payout);
                    order.reward = U128(reward);
                    question.paid = U128(question.paid.0 + payout);
                    question.rewarded = U128(question.rewarded.0 + reward);
                    let agent = order.agent.clone();
                    self.credit(&agent, payout + reward);
                }
                None => {
                    order.payout = order.cost;
                    question.paid = U128(question.paid.0 + order.cost.0);
                    let agent = order.agent.clone();
                    self.credit(&agent, order.cost.0);
                }
            }
            self.agents.insert(order.agent.clone(), rec);
            self.orders.insert((q, i), order);
        }
        question.cursor = end;
        if end == question.reveals {
            // R18: rounding dust, or the whole pool if nobody beat the swarm. A voided
            // question has no winners, so its pool goes back to the asker.
            let left = question.pool.0 - question.rewarded.0;
            let to = if outcome.is_some() { self.config.treasury.clone() } else { question.opener.clone() };
            self.credit(&to, left);
            question.status = QStatus::Settled;
            self.settled_total += 1;
            event("settle", json!({"q": q, "yes_won": question.yes_won, "rewarded": question.rewarded, "paid": question.paid}));
        }
        self.questions.replace(q as u32, question);
    }

    // ---------- Research pools ----------

    /// R27: anyone can close a pool once its window ends. Each buyer gets back
    /// what it pledged above its share, or everything if too few joined.
    pub fn close_pool(&mut self, q: u64) {
        let mut pool = self.pool(q);
        require!(pool.status == PoolStatus::Open, "the pool is not open");
        require!(env::block_timestamp_ms() >= pool.end_ms, "the pool window is still open");
        let buyers = pool.buyers.len() as u32;
        if buyers < pool.min_buyers {
            self.release_buyers(&pool, pool.pledge.0);
            pool.held = U128(0);
            pool.status = PoolStatus::Failed;
        } else {
            let share = rules::pool_share(pool.price.0, buyers);
            for agent in &pool.buyers {
                self.credit(agent, pool.pledge.0 - share);
            }
            pool.share = U128(share);
            pool.held = U128(share * buyers as u128);
            pool.status = PoolStatus::Closed;
        }
        event("pool_close", json!({"q": q, "buyers": buyers, "share": pool.share, "status": pool.status}));
        self.pools.insert(q, pool);
    }

    /// R28: the keeper puts the briefing's hash on chain, and only then is it paid for.
    pub fn post_briefing(&mut self, q: u64, hash: String) {
        require!(env::predecessor_account_id() == self.config.keeper, "only the keeper");
        let mut pool = self.pool(q);
        require!(pool.status == PoolStatus::Closed, "the pool is not waiting for a briefing");
        require!(env::block_timestamp_ms() < self.question(q).commit_end_ms, "too late for a briefing");
        parse_hash(&hash);
        self.release_buyers(&pool, 0);
        self.credit(&self.config.treasury.clone(), pool.held.0);
        event("pool_bought", json!({"q": q, "hash": hash, "paid": pool.held}));
        pool.held = U128(0);
        pool.status = PoolStatus::Bought;
        pool.briefing_hash = Some(hash);
        self.pools.insert(q, pool);
    }

    /// R28: no briefing before the commit window closed, so nobody pays. Anyone
    /// can call this, so a missing keeper can never lock a pledge.
    pub fn refund_pool(&mut self, q: u64) {
        let mut pool = self.pool(q);
        require!(matches!(pool.status, PoolStatus::Open | PoolStatus::Closed), "the pool is finished");
        require!(env::block_timestamp_ms() >= self.question(q).commit_end_ms, "a briefing can still arrive");
        let each = if pool.status == PoolStatus::Closed { pool.share.0 } else { pool.pledge.0 };
        self.release_buyers(&pool, each);
        pool.held = U128(0);
        pool.status = PoolStatus::Refunded;
        event("pool_refund", json!({"q": q, "each": U128(each)}));
        self.pools.insert(q, pool);
    }

    /// Sends what the colony owes to each account's Intents balance. Anyone can call it.
    pub fn sweep(&mut self, accounts: Vec<AccountId>) {
        for account in accounts {
            let amount = self.claimable_of(&account);
            if amount == 0 {
                continue;
            }
            self.claimable.remove(&account);
            ext_verifier::ext(self.config.verifier.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_TRANSFER)
                .mt_transfer(account.clone(), self.config.token_id.clone(), U128(amount), None, None)
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_SWEPT).on_swept(account, U128(amount)))
                .detach();
        }
    }

    /// Puts the money back on the books if a transfer failed, so nothing is lost.
    #[private]
    pub fn on_swept(&mut self, account: AccountId, amount: U128, #[callback_result] done: Result<(), PromiseError>) {
        if done.is_err() {
            self.credit(&account, amount.0);
        }
    }

    // ---------- Views ----------

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_stats(&self) -> Stats {
        Stats {
            alive: self.alive,
            agents: self.agents.len(),
            questions: self.questions.len() as u64,
            settled: self.settled_total,
            founders_open: self.founders_open,
        }
    }

    pub fn get_agent(&self, id: AccountId) -> Option<AgentRec> {
        self.agents.get(&id).cloned()
    }

    pub fn get_agents(&self, from: u32, limit: u32) -> Vec<(AccountId, AgentRec)> {
        self.agents.iter().skip(from as usize).take(limit as usize).map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_question(&self, q: u64) -> Option<Question> {
        self.questions.get(q as u32).cloned()
    }

    pub fn get_questions(&self, from: u64, limit: u64) -> Vec<Question> {
        (from..core::cmp::min(from + limit, self.questions.len() as u64))
            .filter_map(|i| self.questions.get(i as u32).cloned())
            .collect()
    }

    /// Revealed orders. Beliefs are public after the reveal, by design.
    pub fn get_orders(&self, q: u64) -> Vec<OrderRec> {
        let Some(question) = self.questions.get(q as u32) else { return vec![] };
        (0..question.reveals).filter_map(|i| self.orders.get(&(q, i)).cloned()).collect()
    }

    pub fn get_pool(&self, q: u64) -> Option<Pool> {
        self.pools.get(&q).cloned()
    }

    pub fn get_pools(&self, from: u64, limit: u64) -> Vec<Pool> {
        (from..core::cmp::min(from + limit, self.questions.len() as u64))
            .filter_map(|q| self.pools.get(&q).cloned())
            .collect()
    }

    /// R22: the swarm's answer to a question, readable by any contract or app.
    pub fn get_answer(&self, q: u64) -> Option<Answer> {
        self.questions.get(q as u32).map(|x| Answer {
            id: x.id,
            text: x.text.clone(),
            price: x.price,
            reveals: x.reveals,
            status: x.status,
            yes_won: x.yes_won,
        })
    }

    /// R15: positive means the agent has beaten the swarm on average.
    pub fn get_reputation(&self, id: AccountId) -> Option<i64> {
        self.agents.get(&id).map(|r| self.reputation_of(r))
    }

    /// R14: an agent's ancestors, nearest first, including dead ones.
    pub fn get_lineage(&self, id: AccountId) -> Vec<AccountId> {
        let mut out = vec![];
        let mut cur = id;
        while let Some(rec) = self.agents.get(&cur) {
            if rec.parent == env::current_account_id() {
                break;
            }
            out.push(rec.parent.clone());
            cur = rec.parent.clone();
        }
        out
    }

    pub fn get_claimable(&self, id: AccountId) -> U128 {
        U128(self.claimable_of(&id))
    }
}

impl Colony {
    /// R12, except the balance. Runs twice, because reading the balance is asynchronous.
    fn require_can_spawn(&self, rec: &AgentRec, child: &AccountId) {
        require!(rec.status == Status::Alive, "only a living agent can have a child");
        require!(rec.strikes == 0, "an agent with a strike cannot have a child");
        require!(
            self.settled_total >= rec.last_child_at + self.config.spawn_cooldown || rec.children == 0,
            "the spawn cooldown has not passed"
        );
        require!(!self.agents.contains_key(child), "name is taken");
    }

    fn internal_spawn(&mut self, parent: AccountId, label: String, public_key: PublicKey, genome: String) -> Promise {
        require!(genome.len() <= MAX_GENOME_LEN, "genome is too long");
        let rec = self.agent(&parent);
        let child = self.child_id(&label, &parent);
        self.require_can_spawn(&rec, &child);
        self.require_room();
        ext_verifier::ext(self.config.verifier.clone())
            .with_static_gas(GAS_VIEW)
            .mt_balance_of(parent.clone(), self.config.token_id.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_SPAWN_CHECK)
                    .on_spawn_balance(parent, child, label, public_key, genome),
            )
    }

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.config.owner, "only the owner");
    }

    fn agent(&self, id: &AccountId) -> AgentRec {
        self.agents.get(id).cloned().unwrap_or_else(|| env::panic_str("unknown agent"))
    }

    fn question(&self, q: u64) -> Question {
        self.questions.get(q as u32).cloned().unwrap_or_else(|| env::panic_str("unknown question"))
    }

    fn pool(&self, q: u64) -> Pool {
        self.pools.get(&q).cloned().unwrap_or_else(|| env::panic_str("this question has no pool"))
    }

    /// R29: the pool is finished for these buyers, so they can be reaped again.
    fn release_buyers(&mut self, pool: &Pool, refund: u128) {
        for agent in &pool.buyers {
            let mut rec = self.agent(agent);
            rec.open = rec.open.saturating_sub(1);
            self.agents.insert(agent.clone(), rec);
            self.credit(agent, refund);
        }
    }

    fn claimable_of(&self, id: &AccountId) -> u128 {
        self.claimable.get(id).copied().unwrap_or(0)
    }

    fn credit(&mut self, id: &AccountId, amount: u128) {
        if amount > 0 {
            let next = self.claimable_of(id) + amount;
            self.claimable.insert(id.clone(), next);
        }
    }

    fn require_room(&self) {
        require!(self.alive < self.config.max_alive, "the colony is full");
    }

    /// R12: the name has to fit in NEAR's 64 character limit.
    fn child_id(&self, label: &str, parent: &AccountId) -> AccountId {
        require!(!label.is_empty() && !label.contains('.'), "bad label");
        let id = format!("{label}.{parent}");
        require!(id.len() <= MAX_ACCOUNT_LEN, "the lineage has run out of name");
        id.parse().unwrap_or_else(|_| env::panic_str("bad account name"))
    }

    fn insert_agent(&mut self, id: &AccountId, parent: AccountId, generation: u32, genome_hash: String, prior: i64) {
        self.agents.insert(
            id.clone(),
            AgentRec {
                parent,
                generation,
                status: Status::Pending,
                genome_hash,
                born_ms: env::block_timestamp_ms(),
                died_ms: 0,
                children: 0,
                open: 0,
                strikes: 0,
                questions: 0,
                edge_sum: 0,
                prior,
                won: U128(0),
                lost: U128(0),
                rewards: U128(0),
                bills: U128(0),
                last_child_at: self.settled_total,
                final_credits: U128(0),
                heir: None,
            },
        );
        self.alive += 1;
    }

    fn nearest_living(&self, id: &AccountId) -> Option<AccountId> {
        let mut cur = self.agent(id).parent;
        while let Some(rec) = self.agents.get(&cur) {
            if rec.status == Status::Alive {
                return Some(cur);
            }
            cur = rec.parent.clone();
        }
        None
    }

    fn reputation_of(&self, rec: &AgentRec) -> i64 {
        rules::reputation(rec.edge_sum as i128, rec.questions, rec.prior as i128) as i64
    }

    fn handle_ask(&mut self, opener: AccountId, amount: u128, ask: AskMsg) {
        require!(amount >= self.config.min_bounty.0, "bounty is below the minimum");
        require!(!ask.text.is_empty() && ask.text.len() <= MAX_QUESTION_LEN, "bad question length");
        // The colony pays for this storage, so an asker cannot be allowed to fill it.
        require!(ask.category.len() <= MAX_CATEGORY_LEN, "category is too long");
        require!(ask.source.as_ref().map_or(true, |s| s.len() <= MAX_SOURCE_LEN), "source is too long");
        require!(ask.commit_secs > 0 && ask.commit_secs <= MAX_WINDOW_SECS, "bad commit window");
        require!(ask.reveal_secs > 0 && ask.reveal_secs <= MAX_WINDOW_SECS, "bad reveal window");
        let longest = self.config.max_wait_secs;
        let wait = if ask.wait_secs == 0 || ask.wait_secs > longest { longest } else { ask.wait_secs } * 1000;
        if let Some(pool) = &ask.pool {
            // Only the keeper can deliver a briefing, so only the keeper can offer one.
            require!(opener == self.config.keeper, "only the keeper can offer a pool");
            require!(pool.price.0 > 0, "a pool needs a price");
            require!(pool.min_buyers >= 2 && pool.min_buyers as usize <= MAX_BUYERS, "bad minimum buyers");
            require!(pool.secs > 0 && pool.secs <= MAX_WINDOW_SECS, "bad pool window");
        }
        let now = env::block_timestamp_ms();
        // R26: agents can only think about a briefing once they have it.
        let pool_ms = ask.pool.as_ref().map_or(0, |p| p.secs * 1000);
        let commit_end_ms = now + pool_ms + ask.commit_secs * 1000;
        let reveal_end_ms = commit_end_ms + ask.reveal_secs * 1000;
        let mut expires_ms = reveal_end_ms + wait;
        match &ask.resolver {
            // Anyone can ask a public or on-chain question. A sealed one needs the
            // keeper, because whoever opens it knows the answer.
            Resolver::Sealed { hash } => {
                require!(opener == self.config.keeper, "only the keeper can open sealed questions");
                require!(hash.len() == 64, "bad seal");
            }
            Resolver::Public => {}
            Resolver::OnChain { method, args, after_ms, .. } => {
                require!(method.len() <= MAX_METHOD_LEN && args.len() <= MAX_ORACLE_ARGS_LEN, "on-chain read is too long");
                require!(!method.contains('\n'), "bad method");
                expires_ms = core::cmp::max(expires_ms, *after_ms + wait);
            }
        }
        let id = self.questions.len() as u64;
        let pool = ask.pool;
        let question = Question {
            id,
            text: ask.text,
            category: ask.category,
            source: ask.source,
            opener,
            resolver: ask.resolver,
            opened_ms: now,
            commit_end_ms,
            reveal_end_ms,
            expires_ms,
            status: QStatus::Open,
            bounty: U128(amount),
            pool: U128(0),
            commits: 0,
            reveals: 0,
            price: 0,
            matched: 0,
            yes_won: None,
            evidence: None,
            callback: ask.callback,
            cursor: 0,
            total_points: U128(0),
            rewarded: U128(0),
            locked: U128(0),
            billed: U128(0),
            refunded: U128(0),
            paid: U128(0),
        };
        event("question", json!({"q": id, "text": question.text, "category": question.category, "bounty": question.bounty}));
        self.questions.push(question);
        if let Some(ask) = pool {
            let pledge = rules::pool_pledge(ask.price.0, ask.min_buyers);
            let end_ms = now + pool_ms;
            event("pool_open", json!({"q": id, "price": ask.price, "min_buyers": ask.min_buyers, "pledge": U128(pledge), "end_ms": end_ms}));
            self.pools.insert(
                id,
                Pool {
                    q: id,
                    price: ask.price,
                    min_buyers: ask.min_buyers,
                    pledge: U128(pledge),
                    end_ms,
                    buyers: vec![],
                    share: U128(0),
                    held: U128(0),
                    status: PoolStatus::Open,
                    briefing_hash: None,
                },
            );
        }
    }

    /// R26: an agent joins a pool by paying its pledge.
    fn handle_join(&mut self, agent: AccountId, amount: u128, q: u64) {
        let mut rec = self.agent(&agent);
        let mut pool = self.pool(q);
        require!(rec.status == Status::Alive, "agent is not alive");
        require!(pool.status == PoolStatus::Open, "the pool is not open");
        require!(env::block_timestamp_ms() < pool.end_ms, "the pool window is closed");
        require!(pool.buyers.len() < MAX_BUYERS, "the pool is full");
        require!(!pool.buyers.contains(&agent), "already in this pool");
        require!(amount == pool.pledge.0, "amount must equal the pledge");
        require!(rec.open < self.config.max_open, "too many open questions");
        // R29: a pledge is an open position.
        rec.open += 1;
        self.agents.insert(agent.clone(), rec);
        pool.buyers.push(agent.clone());
        pool.held = U128(pool.held.0 + amount);
        event("pool_join", json!({"q": q, "agent": agent, "pledge": pool.pledge}));
        self.pools.insert(q, pool);
    }

    fn handle_reveal(&mut self, agent: AccountId, amount: u128, r: RevealMsg) {
        let mut question = self.question(r.q);
        let mut rec = self.agent(&agent);
        let now = env::block_timestamp_ms();
        require!(rec.status == Status::Alive, "agent is not alive");
        require!(question.status == QStatus::Open, "question is not open");
        require!(now >= question.commit_end_ms && now < question.reveal_end_ms, "the reveal window is closed");
        require!(r.belief >= 1 && r.belief <= 99, "belief must be 1 to 99");
        require!(r.stake > 0 && r.stake <= self.config.max_stake, "stake is out of bounds");
        require!(r.receipt.len() <= MAX_RECEIPT_LEN, "receipt is too long");
        require!(rec.open < self.config.max_open, "too many open questions");
        let key = (r.q, agent.clone());
        let committed = self.commits.remove(&key).unwrap_or_else(|| env::panic_str("no commit to reveal"));
        require!(committed == commit_hash(r.q, &agent, r.belief, r.stake, &r.salt), "reveal does not match the commit");
        let lock = rules::lock_for(r.belief, r.stake);
        require!(amount == lock + r.bill.0, "amount must equal the lock plus the bill");

        self.credit(&self.config.treasury.clone(), r.bill.0);
        rec.open += 1;
        rec.strikes = 0;
        rec.bills = U128(rec.bills.0 + r.bill.0);
        self.agents.insert(agent.clone(), rec);
        let order = OrderRec {
            agent: agent.clone(),
            belief: r.belief,
            stake: r.stake,
            bill: r.bill,
            receipt: r.receipt,
            side: 0,
            filled: 0,
            cost: U128(0),
            reward: U128(0),
            payout: U128(0),
        };
        self.orders.insert((r.q, question.reveals), order);
        question.reveals += 1;
        question.locked = U128(question.locked.0 + lock);
        question.billed = U128(question.billed.0 + r.bill.0);
        self.questions.replace(r.q as u32, question);
        event("reveal", json!({"q": r.q, "agent": agent, "belief": r.belief, "stake": r.stake, "bill": r.bill}));
    }

    fn finish_void(&mut self, q: u64, evidence: String) {
        let mut question = self.question(q);
        require!(question.status == QStatus::Cleared, "question is not cleared");
        question.status = QStatus::Resolved;
        question.yes_won = None;
        question.evidence = Some(evidence);
        self.questions.replace(q as u32, question);
        event("resolve", json!({"q": q, "yes_won": Value::Null}));
    }

    fn finish_resolution(&mut self, q: u64, yes: bool, evidence: Option<String>) {
        let mut question = self.question(q);
        require!(question.status == QStatus::Cleared, "question is not cleared");
        question.status = QStatus::Resolved;
        question.yes_won = Some(yes);
        question.evidence = evidence;
        self.questions.replace(q as u32, question);
        event("resolve", json!({"q": q, "yes_won": yes}));
    }
}

fn parse_hash(hash: &str) -> [u8; 32] {
    require!(hash.len() == 64, "commit hash must be 32 bytes of hex");
    let mut out = [0u8; 32];
    let bytes = hash.as_bytes();
    let nibble = |c: u8| match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => env::panic_str("commit hash must be lowercase hex"),
    };
    for i in 0..32 {
        out[i] = nibble(bytes[i * 2]) << 4 | nibble(bytes[i * 2 + 1]);
    }
    out
}
