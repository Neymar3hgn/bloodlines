//! Development tool: deletes storage keys so an account can take a fresh contract.
//! Arguments are repeated records of a two-byte little-endian length and a key.
//! It only runs for a call the account makes to itself. It is never left deployed.

#![no_std]

use core::panic::PanicInfo;

extern "C" {
    fn input(register_id: u64);
    fn read_register(register_id: u64, ptr: u64);
    fn register_len(register_id: u64) -> u64;
    fn current_account_id(register_id: u64);
    fn predecessor_account_id(register_id: u64);
    fn storage_remove(key_len: u64, key_ptr: u64, register_id: u64) -> u64;
}

#[panic_handler]
fn on_panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

const REG: u64 = 0;
const MAX: usize = 60_000;
static mut BUF: [u8; MAX] = [0; MAX];

#[no_mangle]
pub extern "C" fn clean() {
    unsafe {
        let (mut a, mut b) = ([0u8; 64], [0u8; 64]);
        current_account_id(REG);
        let la = register_len(REG) as usize;
        read_register(REG, a.as_mut_ptr() as u64);
        predecessor_account_id(REG);
        let lb = register_len(REG) as usize;
        read_register(REG, b.as_mut_ptr() as u64);
        if a[..la] != b[..lb] {
            core::arch::wasm32::unreachable();
        }

        input(REG);
        let len = register_len(REG) as usize;
        if len > MAX {
            core::arch::wasm32::unreachable();
        }
        let buf = core::ptr::addr_of_mut!(BUF) as *mut u8;
        read_register(REG, buf as u64);
        let mut i = 0usize;
        while i + 2 <= len {
            let n = *buf.add(i) as usize | (*buf.add(i + 1) as usize) << 8;
            i += 2;
            storage_remove(n as u64, buf.add(i) as u64, REG);
            i += n;
        }
    }
}
