//! The smallest possible consumer of the swarm's answer (R22).
//!
//! Open a question with `callback` set to a contract like this one, and the
//! colony calls `on_clade_answer(question_id, price)` as soon as the round
//! clears. A real contract would act here: release an escrow, price a policy,
//! accept or reject a piece of work. This one stores the last answer.

#![no_std]

use core::panic::PanicInfo;

extern "C" {
    fn input(register_id: u64);
    fn read_register(register_id: u64, ptr: u64);
    fn register_len(register_id: u64) -> u64;
    fn storage_write(key_len: u64, key_ptr: u64, value_len: u64, value_ptr: u64, register_id: u64) -> u64;
    fn storage_read(key_len: u64, key_ptr: u64, register_id: u64) -> u64;
    fn value_return(value_len: u64, value_ptr: u64);
}

#[panic_handler]
fn on_panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const KEY: &[u8] = b"last";

/// Called by the colony with `{"question_id":7,"price":71}`.
#[no_mangle]
pub extern "C" fn on_clade_answer() {
    let mut buf = [0u8; 128];
    unsafe {
        input(0);
        let len = register_len(0) as usize;
        if len > buf.len() {
            core::arch::wasm32::unreachable();
        }
        read_register(0, buf.as_mut_ptr() as u64);
        storage_write(KEY.len() as u64, KEY.as_ptr() as u64, len as u64, buf.as_ptr() as u64, 1);
    }
}

/// Returns the last answer received, exactly as the colony sent it.
#[no_mangle]
pub extern "C" fn last_answer() {
    let mut buf = [0u8; 128];
    unsafe {
        if storage_read(KEY.len() as u64, KEY.as_ptr() as u64, 0) == 1 {
            let len = register_len(0) as usize;
            read_register(0, buf.as_mut_ptr() as u64);
            value_return(len as u64, buf.as_ptr() as u64);
        } else {
            value_return(4, b"null".as_ptr() as u64);
        }
    }
}
