/**
 * Replaces Rust's float-printing code with a trap, before wasm-opt runs.
 *
 * Contract bytes cost NEAR, about 0.01 per KB. The colony has no floats, but serde's error
 * messages can print one, so about 18 KB of float formatting gets linked in and only an
 * error path can reach it. A trap there still aborts the call, with a shorter message.
 *
 *   node scripts/snip-floats.mjs in.wasm out.wasm
 */
import { readFileSync, writeFileSync } from "node:fs";

const SNIP = /flt2dec|3fmt5float|float_to_decimal|float_to_exponential|float_to_general|6bignum/;

const [input, output] = process.argv.slice(2);
const wasm = readFileSync(input);

function leb(at) {
  let value = 0;
  let shift = 0;
  let next = at;
  for (;;) {
    const byte = wasm[next++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next };
    shift += 7;
  }
}

function encode(value) {
  const out = [];
  let rest = value;
  do {
    let byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return Buffer.from(out);
}

const text = (from, to) => wasm.toString("utf8", from, to);

const sections = [];
for (let at = 8; at < wasm.length; ) {
  const id = wasm[at];
  const size = leb(at + 1);
  sections.push({ id, start: at, body: size.next, end: size.next + size.value });
  at = size.next + size.value;
}

// Function indices count imported functions first.
let imported = 0;
const imports = sections.find((s) => s.id === 2);
if (imports) {
  let at = imports.body;
  const count = leb(at);
  at = count.next;
  for (let i = 0; i < count.value; i++) {
    at = (({ value, next }) => next + value)(leb(at));
    at = (({ value, next }) => next + value)(leb(at));
    const kind = wasm[at++];
    if (kind === 0) {
      imported++;
      at = leb(at).next;
    } else if (kind === 1) {
      at += 1;
      const flags = wasm[at++];
      at = leb(at).next;
      if (flags & 1) at = leb(at).next;
    } else if (kind === 2) {
      const flags = wasm[at++];
      at = leb(at).next;
      if (flags & 1) at = leb(at).next;
    } else if (kind === 3) {
      at += 2;
    } else {
      throw new Error(`unknown import kind ${kind}`);
    }
  }
}

const names = new Map();
for (const s of sections.filter((x) => x.id === 0)) {
  const name = leb(s.body);
  if (text(name.next, name.next + name.value) !== "name") continue;
  for (let at = name.next + name.value; at < s.end; ) {
    const kind = wasm[at];
    const size = leb(at + 1);
    if (kind === 1) {
      let p = size.next;
      const count = leb(p);
      p = count.next;
      for (let i = 0; i < count.value; i++) {
        const index = leb(p);
        const len = leb(index.next);
        names.set(index.value, text(len.next, len.next + len.value));
        p = len.next + len.value;
      }
    }
    at = size.next + size.value;
  }
}
if (names.size === 0) throw new Error("this wasm has no function names, so nothing can be snipped");

const code = sections.find((s) => s.id === 10);
const count = leb(code.body);
const bodies = [encode(count.value)];
const TRAP = Buffer.from([3, 0, 0x00, 0x0b]); // size 3, no locals, unreachable, end
let snipped = 0;
let saved = 0;
let at = count.next;
for (let i = 0; i < count.value; i++) {
  const size = leb(at);
  const end = size.next + size.value;
  if (SNIP.test(names.get(imported + i) ?? "")) {
    bodies.push(TRAP);
    snipped++;
    saved += end - at - TRAP.length;
  } else {
    bodies.push(wasm.subarray(at, end));
  }
  at = end;
}

const payload = Buffer.concat(bodies);
writeFileSync(output, Buffer.concat([wasm.subarray(0, code.start), Buffer.from([10]), encode(payload.length), payload, wasm.subarray(code.end)]));
console.log(`snipped ${snipped} float functions, ${saved} bytes before optimizing`);
