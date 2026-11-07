import { clearingPrice } from "../../engine/market.ts";

document.getElementById("root")!.textContent = `engine ok ${clearingPrice([{ agent: "a", belief: 40, stake: 1n }])}`;
