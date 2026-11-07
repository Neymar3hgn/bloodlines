//! The contract every Clade agent runs, deployed once as a global contract.
//!
//! It is written directly against NEAR's host functions, with no SDK and no
//! allocator, so it stays under 10 KB. Size matters here: a global contract
//! burns 10 NEAR per 100 KB when deployed, and this one is shared by every agent.
//!
//! An agent account holds no full-access key, so nobody can move its native NEAR
//! or change its code. Only the colony can tell it to have a child or to die,
//! and the colony only does that when RULES.md allows it. The one key on the
//! account can call the colony's agent methods and nothing else (R3).
//!
//! Arguments are newline-separated text, written by the colony and read here.

#![no_std]

use core::panic::PanicInfo;

extern "C" {
    fn input(register_id: u64);
    fn read_register(register_id: u64, ptr: u64);
    fn register_len(register_id: u64) -> u64;
    fn current_account_id(register_id: u64);
    fn predecessor_account_id(register_id: u64);
    fn attached_deposit(balance_ptr: u64);
    fn storage_write(key_len: u64, key_ptr: u64, value_len: u64, value_ptr: u64, register_id: u64) -> u64;
    fn storage_read(key_len: u64, key_ptr: u64, register_id: u64) -> u64;
    fn panic_utf8(len: u64, ptr: u64) -> !;
    fn promise_batch_create(account_id_len: u64, account_id_ptr: u64) -> u64;
    fn promise_batch_then(promise_index: u64, account_id_len: u64, account_id_ptr: u64) -> u64;
    fn promise_batch_action_create_account(promise_index: u64);
    fn promise_batch_action_transfer(promise_index: u64, amount_ptr: u64);
    fn promise_batch_action_function_call(
        promise_index: u64,
        function_name_len: u64,
        function_name_ptr: u64,
        arguments_len: u64,
        arguments_ptr: u64,
        amount_ptr: u64,
        gas: u64,
    );
    fn promise_batch_action_add_key_with_function_call(
        promise_index: u64,
        public_key_len: u64,
        public_key_ptr: u64,
        nonce: u64,
        allowance_ptr: u64,
        receiver_id_len: u64,
        receiver_id_ptr: u64,
        function_names_len: u64,
        function_names_ptr: u64,
    );
    fn promise_batch_action_delete_account(promise_index: u64, beneficiary_id_len: u64, beneficiary_id_ptr: u64);
    fn promise_batch_action_use_global_contract_by_account_id(promise_index: u64, account_id_len: u64, account_id_ptr: u64);
    fn promise_results_count() -> u64;
    fn promise_result(result_idx: u64, register_id: u64) -> u64;
    fn promise_return(promise_id: u64);
}

#[panic_handler]
fn on_panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const TGAS: u64 = 1_000_000_000_000;
const REG: u64 = 0;
const KEY: &[u8] = b"s";
const ZERO: [u8; 16] = 0u128.to_le_bytes();
const ONE_YOCTO: [u8; 16] = 1u128.to_le_bytes();
/// The only colony methods an agent's key may call.
const AGENT_METHODS: &[u8] = b"commit,spawn";

fn fail(msg: &str) -> ! {
    unsafe { panic_utf8(msg.len() as u64, msg.as_ptr() as u64) }
}

fn register<'a>(buf: &'a mut [u8]) -> &'a [u8] {
    unsafe {
        let len = register_len(REG) as usize;
        if len > buf.len() {
            fail("value too long");
        }
        read_register(REG, buf.as_mut_ptr() as u64);
        &buf[..len]
    }
}

fn args<'a>(buf: &'a mut [u8]) -> &'a [u8] {
    unsafe { input(REG) };
    register(buf)
}

fn me<'a>(buf: &'a mut [u8]) -> &'a [u8] {
    unsafe { current_account_id(REG) };
    register(buf)
}

fn caller<'a>(buf: &'a mut [u8]) -> &'a [u8] {
    unsafe { predecessor_account_id(REG) };
    register(buf)
}

/// The nth newline-separated field.
fn field(data: &[u8], index: usize) -> &[u8] {
    data.split(|b| *b == b'\n').nth(index).unwrap_or_else(|| fail("missing field"))
}

/// Builds a byte string in a fixed buffer, with no allocator.
struct Text<'a> {
    buf: &'a mut [u8],
    len: usize,
}

impl<'a> Text<'a> {
    fn new(buf: &'a mut [u8]) -> Self {
        Self { buf, len: 0 }
    }

    fn add(mut self, part: &[u8]) -> Self {
        if self.len + part.len() > self.buf.len() {
            fail("text too long");
        }
        self.buf[self.len..self.len + part.len()].copy_from_slice(part);
        self.len += part.len();
        self
    }

    fn done(self) -> &'a [u8] {
        &self.buf[..self.len]
    }
}

fn call(promise: u64, method: &[u8], arguments: &[u8], deposit: &[u8; 16], tgas: u64) {
    unsafe {
        promise_batch_action_function_call(
            promise,
            method.len() as u64,
            method.as_ptr() as u64,
            arguments.len() as u64,
            arguments.as_ptr() as u64,
            deposit.as_ptr() as u64,
            tgas * TGAS,
        );
    }
}

fn batch(account: &[u8]) -> u64 {
    unsafe { promise_batch_create(account.len() as u64, account.as_ptr() as u64) }
}

fn then(promise: u64, account: &[u8]) -> u64 {
    unsafe { promise_batch_then(promise, account.len() as u64, account.as_ptr() as u64) }
}

fn state<'a>(buf: &'a mut [u8]) -> &'a [u8] {
    if unsafe { storage_read(KEY.len() as u64, KEY.as_ptr() as u64, REG) } != 1 {
        fail("agent is not initialized");
    }
    register(buf)
}

/// Returns true only if the last promise succeeded, leaving its value in the register.
fn last_ok() -> bool {
    unsafe { promise_results_count() == 1 && promise_result(0, REG) == 1 }
}

fn only_self() {
    let (mut a, mut b) = ([0u8; 64], [0u8; 64]);
    if caller(&mut a) != me(&mut b) {
        fail("private method");
    }
}

fn only_colony(st: &[u8]) {
    let mut a = [0u8; 64];
    if caller(&mut a) != field(st, 0) {
        fail("only the colony can do this");
    }
}

fn hex_val(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => fail("bad hex"),
    }
}

fn delete_self(heir: &[u8]) {
    let mut who = [0u8; 64];
    let p = batch(me(&mut who));
    unsafe {
        promise_batch_action_delete_account(p, heir.len() as u64, heir.as_ptr() as u64);
        promise_return(p);
    }
}

fn transfer_json<'a>(buf: &'a mut [u8], to: &[u8], token: &[u8], amount: &[u8]) -> &'a [u8] {
    Text::new(buf)
        .add(b"{\"receiver_id\":\"")
        .add(to)
        .add(b"\",\"token_id\":\"")
        .add(token)
        .add(b"\",\"amount\":\"")
        .add(amount)
        .add(b"\"}")
        .done()
}

/// colony \n verifier \n token \n code \n public key string.
/// Stores the first four and registers the signing key on the Intents contract.
#[no_mangle]
pub extern "C" fn new() {
    let mut a = [0u8; 512];
    let data = args(&mut a);
    if unsafe { storage_read(KEY.len() as u64, KEY.as_ptr() as u64, REG) } == 1 {
        fail("already initialized");
    }
    let mut s = [0u8; 400];
    let saved = Text::new(&mut s)
        .add(field(data, 0))
        .add(b"\n")
        .add(field(data, 1))
        .add(b"\n")
        .add(field(data, 2))
        .add(b"\n")
        .add(field(data, 3))
        .done();
    unsafe {
        storage_write(KEY.len() as u64, KEY.as_ptr() as u64, saved.len() as u64, saved.as_ptr() as u64, REG);
    }
    let mut j = [0u8; 128];
    let json = Text::new(&mut j).add(b"{\"public_key\":\"").add(field(data, 4)).add(b"\"}").done();
    let p = batch(field(data, 1));
    call(p, b"add_public_key", json, &ONE_YOCTO, 5);
}

/// label \n key as hex \n key as string \n credits.
/// R1: only a parent can create `label.parent`, so the colony asks the parent.
#[no_mangle]
pub extern "C" fn create_child() {
    let mut sb = [0u8; 400];
    let st = state(&mut sb);
    only_colony(st);
    let mut a = [0u8; 512];
    let data = args(&mut a);

    let mut mine = [0u8; 64];
    let my_id = me(&mut mine);
    let mut c = [0u8; 80];
    let child = Text::new(&mut c).add(field(data, 0)).add(b".").add(my_id).done();

    let hexkey = field(data, 1);
    if hexkey.len() != 66 {
        fail("bad key");
    }
    let mut key = [0u8; 33];
    for i in 0..33 {
        key[i] = hex_val(hexkey[i * 2]) << 4 | hex_val(hexkey[i * 2 + 1]);
    }

    let mut n = [0u8; 512];
    let new_args = Text::new(&mut n).add(st).add(b"\n").add(field(data, 2)).done();

    let mut deposit = [0u8; 16];
    unsafe { attached_deposit(deposit.as_mut_ptr() as u64) };

    let colony = field(st, 0);
    let code = field(st, 3);
    let p = batch(child);
    unsafe {
        promise_batch_action_create_account(p);
        promise_batch_action_transfer(p, deposit.as_ptr() as u64);
        promise_batch_action_use_global_contract_by_account_id(p, code.len() as u64, code.as_ptr() as u64);
    }
    call(p, b"new", new_args, &ZERO, 15);
    unsafe {
        promise_batch_action_add_key_with_function_call(
            p,
            33,
            key.as_ptr() as u64,
            0,
            ZERO.as_ptr() as u64,
            colony.len() as u64,
            colony.as_ptr() as u64,
            AGENT_METHODS.len() as u64,
            AGENT_METHODS.as_ptr() as u64,
        );
    }
    let mut cb = [0u8; 128];
    let cb_args = Text::new(&mut cb).add(child).add(b"\n").add(field(data, 3)).done();
    let q = then(p, my_id);
    call(q, b"on_child_created", cb_args, &ZERO, 25);
    unsafe { promise_return(q) };
}

/// Hands the child its endowment once the account exists. If creation failed,
/// this panics and the colony cancels the birth.
#[no_mangle]
pub extern "C" fn on_child_created() {
    only_self();
    if !last_ok() {
        fail("child was not created");
    }
    let mut sb = [0u8; 400];
    let st = state(&mut sb);
    let mut a = [0u8; 128];
    let data = args(&mut a);
    let mut j = [0u8; 320];
    let json = transfer_json(&mut j, field(data, 0), field(st, 2), field(data, 1));
    let p = batch(field(st, 1));
    call(p, b"mt_transfer", json, &ONE_YOCTO, 12);
    unsafe { promise_return(p) };
}

/// credit heir \n near heir.
/// R13: the colony has found this agent broke, so read the final balance.
#[no_mangle]
pub extern "C" fn die() {
    let mut sb = [0u8; 400];
    let st = state(&mut sb);
    only_colony(st);
    let mut a = [0u8; 160];
    let data = args(&mut a);
    let mut mine = [0u8; 64];
    let my_id = me(&mut mine);
    let mut j = [0u8; 256];
    let json = Text::new(&mut j)
        .add(b"{\"account_id\":\"")
        .add(my_id)
        .add(b"\",\"token_id\":\"")
        .add(field(st, 2))
        .add(b"\"}")
        .done();
    let p = batch(field(st, 1));
    call(p, b"mt_balance_of", json, &ZERO, 5);
    let q = then(p, my_id);
    call(q, b"on_final_balance", data, &ZERO, 40);
    unsafe { promise_return(q) };
}

/// Pays the heir, then deletes the account. Money first, deletion second.
#[no_mangle]
pub extern "C" fn on_final_balance() {
    only_self();
    if !last_ok() {
        fail("could not read the final balance");
    }
    let mut r = [0u8; 48];
    let raw = register(&mut r);
    if raw.len() < 3 {
        fail("bad balance");
    }
    let digits = &raw[1..raw.len() - 1]; // The Intents contract returns "123" with quotes.
    let mut sb = [0u8; 400];
    let st = state(&mut sb);
    let mut a = [0u8; 160];
    let data = args(&mut a);
    let near_heir = field(data, 1);
    if digits == b"0" {
        delete_self(near_heir);
        return;
    }
    let mut j = [0u8; 320];
    let json = transfer_json(&mut j, field(data, 0), field(st, 2), digits);
    let p = batch(field(st, 1));
    call(p, b"mt_transfer", json, &ONE_YOCTO, 12);
    let mut mine = [0u8; 64];
    let q = then(p, me(&mut mine));
    call(q, b"on_inheritance_paid", near_heir, &ZERO, 4);
    unsafe { promise_return(q) };
}

/// The account is only deleted once the money has safely left it.
#[no_mangle]
pub extern "C" fn on_inheritance_paid() {
    only_self();
    if !last_ok() {
        fail("inheritance transfer failed");
    }
    let mut a = [0u8; 64];
    delete_self(args(&mut a));
}
