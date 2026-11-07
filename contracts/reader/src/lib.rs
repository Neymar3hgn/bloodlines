//! Makes the on-chain read for a self-resolving question.
//!
//! This contract exists for security. An asker chooses which contract and method
//! a question reads, so that call must not come from the colony: agents obey the
//! colony, and a question could otherwise name `agent.die` and steal an agent's
//! money. Reads go through this account instead. It holds nothing, is trusted by
//! nothing, and attaches no deposit, so whatever an asker names runs with no
//! authority at all.
//!
//! Arguments: contract \n method \n args.

#![no_std]

use core::panic::PanicInfo;

extern "C" {
    fn input(register_id: u64);
    fn read_register(register_id: u64, ptr: u64);
    fn register_len(register_id: u64) -> u64;
    fn promise_batch_create(account_id_len: u64, account_id_ptr: u64) -> u64;
    fn promise_batch_action_function_call(
        promise_index: u64,
        function_name_len: u64,
        function_name_ptr: u64,
        arguments_len: u64,
        arguments_ptr: u64,
        amount_ptr: u64,
        gas: u64,
    );
    fn promise_return(promise_id: u64);
}

#[panic_handler]
fn on_panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const NO_DEPOSIT: [u8; 16] = [0; 16];
const READ_GAS: u64 = 20_000_000_000_000;

#[no_mangle]
pub extern "C" fn read() {
    let mut buf = [0u8; 1024];
    unsafe {
        input(0);
        let len = register_len(0) as usize;
        if len > buf.len() {
            core::arch::wasm32::unreachable();
        }
        read_register(0, buf.as_mut_ptr() as u64);
        let data = &buf[..len];

        let first = data.iter().position(|b| *b == b'\n').unwrap_or_else(|| core::arch::wasm32::unreachable());
        let contract = &data[..first];
        let rest = &data[first + 1..];
        let second = rest.iter().position(|b| *b == b'\n').unwrap_or_else(|| core::arch::wasm32::unreachable());
        let method = &rest[..second];
        let arguments = &rest[second + 1..];

        let p = promise_batch_create(contract.len() as u64, contract.as_ptr() as u64);
        promise_batch_action_function_call(
            p,
            method.len() as u64,
            method.as_ptr() as u64,
            arguments.len() as u64,
            arguments.as_ptr() as u64,
            NO_DEPOSIT.as_ptr() as u64,
            READ_GAS,
        );
        promise_return(p);
    }
}
