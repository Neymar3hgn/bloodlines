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
const MAX_ACCOUNT_LEN: usize = 64;
const STRIKES_TO_REAP: u8 = 3;

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

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub struct AskMsg {
    pub text: String,
    pub category: String,
    pub source: Option<String>,
    pub resolver: Resolver,
    pub commit_secs: u64,
    pub reveal_secs: u64,
    pub callback: Option<AccountId>,
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
        }
    }

    // ---------- Agents ----------

    /// R2: founders are children of the colony.
    pub fn add_founder(&mut self, label: String, public_key: PublicKey, genome: String) -> Promise {
        self.only_owner();
        require!(self.founders_open, "the season has started");
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

    /// R12: an agent asks to have a child. The agent's key calls this.
    pub fn spawn(&mut self, label: String, public_key: PublicKey, genome: String) -> Promise {
        let parent = env::predecessor_account_id();
        let rec = self.agent(&parent);
        require!(rec.status == Status::Alive, "only a living agent can have a child");
        require!(rec.strikes == 0, "an agent with a strike cannot have a child");
        require!(
            self.settled_total >= rec.last_child_at + self.config.spawn_cooldown || rec.children == 0,
            "the spawn cooldown has not passed"
        );
        self.require_room();
        let child = self.child_id(&label, &parent);
        require!(!self.agents.contains_key(&child), "name is taken");
        ext_verifier::ext(self.config.verifier.clone())
            .with_static_gas(GAS_VIEW)
            .mt_balance_of(parent.clone(), self.config.token_id.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_SPAWN_CHECK)
                    .on_spawn_balance(parent, child, label, public_key, genome),
            )
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
        require!(
            balance < self.config.floor.0 || rec.strikes >= STRIKES_TO_REAP,
            "agent is solvent and has no strikes"
        );
        let heir = self.nearest_living(&agent);
        rec.status = Status::Dead;
        rec.died_ms = env::block_timestamp_ms();
        self.agents.insert(agent.clone(), rec);
        self.alive -= 1;
        let (credit_heir, near_heir) = match heir {
            Some(h) => (h.clone(), h),
            None => (self.config.treasury.clone(), env::current_account_id()),
        };
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
        Promise::new(contract)
            .function_call(method, args.into_bytes(), NO_DEPOSIT, GAS_ORACLE)
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

    /// The keeper can void a question whose source vanished. Everyone gets their cost back.
    pub fn void_question(&mut self, q: u64, evidence: String) {
        require!(env::predecessor_account_id() == self.config.keeper, "only the keeper");
        let mut question = self.question(q);
        require!(question.status == QStatus::Cleared, "question is not cleared");
        question.status = QStatus::Resolved;
        question.yes_won = None;
        question.evidence = Some(evidence);
        self.questions.replace(q as u32, question);
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
            // R18: rounding dust, or the whole pool if nobody beat the swarm.
            let left = question.pool.0 - question.rewarded.0;
            self.credit(&self.config.treasury.clone(), left);
            question.status = QStatus::Settled;
            self.settled_total += 1;
            event("settle", json!({"q": q, "yes_won": question.yes_won, "rewarded": question.rewarded, "paid": question.paid}));
        }
        self.questions.replace(q as u32, question);
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
    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.config.owner, "only the owner");
    }

    fn agent(&self, id: &AccountId) -> AgentRec {
        self.agents.get(id).cloned().unwrap_or_else(|| env::panic_str("unknown agent"))
    }

    fn question(&self, q: u64) -> Question {
        self.questions.get(q as u32).cloned().unwrap_or_else(|| env::panic_str("unknown question"))
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
        require!(ask.commit_secs > 0 && ask.reveal_secs > 0, "bad windows");
        if matches!(ask.resolver, Resolver::Public) || matches!(ask.resolver, Resolver::Sealed { .. }) {
            require!(opener == self.config.keeper, "only the keeper can open off-chain questions");
        }
        let id = self.questions.len() as u64;
        let now = env::block_timestamp_ms();
        let commit_end_ms = now + ask.commit_secs * 1000;
        let question = Question {
            id,
            text: ask.text,
            category: ask.category,
            source: ask.source,
            opener,
            resolver: ask.resolver,
            opened_ms: now,
            commit_end_ms,
            reveal_end_ms: commit_end_ms + ask.reveal_secs * 1000,
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
