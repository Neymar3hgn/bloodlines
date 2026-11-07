/** Turns chain units and timestamps into words. Money stays in bigint so nothing is lost to floats. */

const UNIT_DIGITS = 6;

export const tokenSymbol = (network: string) => (network === "mainnet" ? "USDC" : "tUSD");

export type Units = string | number | bigint | null | undefined;

export function big(units: Units): bigint {
  if (units === null || units === undefined) return 0n;
  try {
    return BigInt(units);
  } catch {
    return 0n;
  }
}

function group(whole: bigint): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Rounds to `dp` decimals, half up, and keeps exactly that many digits. */
function rounded(units: bigint, dp: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const step = 10n ** BigInt(UNIT_DIGITS - dp);
  const scaled = (abs + step / 2n) / step;
  const scale = 10n ** BigInt(dp);
  const whole = scaled / scale;
  const frac = dp ? `.${(scaled % scale).toString().padStart(dp, "0")}` : "";
  return `${negative && scaled > 0n ? "-" : ""}${group(whole)}${frac}`;
}

const trim = (text: string, minDp: number) => {
  if (!text.includes(".")) return text;
  const [whole, frac] = text.split(".");
  let end = frac.length;
  while (end > minDp && frac[end - 1] === "0") end -= 1;
  return end ? `${whole}.${frac.slice(0, end)}` : whole;
};

/** For reading: 1.23, 0.88, 0.0469, 0.005733. A non-zero amount never prints as zero. */
export function money(units: Units): string {
  const u = big(units);
  const abs = u < 0n ? -u : u;
  if (abs === 0n) return "0";
  if (abs >= 1_000_000n) return rounded(u, 2);
  if (abs >= 10_000n) return trim(rounded(u, 4), 2);
  return trim(rounded(u, 6), 2);
}

/** The whole amount to the last unit, for the money balance. */
export function exact(units: Units): string {
  return trim(rounded(big(units), UNIT_DIGITS), 2);
}

/** Every digit, so a ledger's columns line up. */
export const six = (units: Units) => rounded(big(units), UNIT_DIGITS);

/** For columns of numbers: four decimals so they line up, more only if that would hide the value. */
export function column(units: Units): string {
  const u = big(units);
  if (u === 0n) return "0";
  const abs = u < 0n ? -u : u;
  return abs < 50n ? rounded(u, 6) : rounded(u, 4);
}

export const signed = (u: bigint, text: string) => (u > 0n ? `+${text}` : text);

const LOCALE = undefined; // The reader's own.
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const stampFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clockFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const date = (ms: number) => dateFmt.format(ms);
export const stamp = (ms: number) => stampFmt.format(ms);
export const clock = (ms: number) => clockFmt.format(ms);

export function span(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function age(ms: number): string {
  const d = Math.max(0, ms);
  return d < 5_000 ? "just now" : `${span(d)} ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
