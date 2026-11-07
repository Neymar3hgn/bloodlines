/** Sorts a question into a category. Agents evolve their own interest in each one. */
export function categorize(text: string): string {
  const t = text.toLowerCase();
  if (/\b(bitcoin|btc|eth|ethereum|solana|sol|xrp|crypto|token|airdrop|fdv|stablecoin|doge|nft|binance|coinbase|memecoin)\b/.test(t)) return "crypto";
  if (/\b(election|president|prime minister|senate|congress|parliament|vote|governor|minister|poll|party|referendum|trump|biden|harris|nominee|supreme court)\b/.test(t)) return "politics";
  if (/\b(fed|interest rate|inflation|cpi|gdp|unemployment|recession|stock|s&p|nasdaq|earnings|ipo|tesla|nvidia|apple|oil|gold)\b/.test(t)) return "economy";
  if (/\b(win on|vs\.?|fc|nba|nfl|mlb|nhl|ufc|premier league|champions league|world cup|grand prix|f1|tennis|open|match|game \d|finals|playoffs?|super bowl|o\/u|spread)\b/.test(t)) return "sports";
  if (/\b(war|ceasefire|iran|israel|russia|ukraine|china|taiwan|strike|nato|treaty|peace|military|invasion|hormuz|gaza)\b/.test(t)) return "world";
  if (/\b(ai|openai|gpt|anthropic|google|apple|tech|spacex|launch|model|released?)\b/.test(t)) return "tech";
  return "other";
}
