# Submission kit

Deadline: 14 Nov 2026, 23:59 UTC. Submissions cannot be edited afterwards, only
changed through a manual request, so check everything once before sending.

## Checklist

- [ ] Repo is public, with a LICENSE, and stays public through judging
- [ ] No keys or secrets anywhere in git history (`.keys/` and `.env` are ignored)
- [ ] README results updated with the final AI run
- [ ] Site is live, and stays up until at least 18 Nov, ideally 25 Nov
- [ ] Demo video recorded, and the X post is live
- [ ] Mainnet NEAR account ready for the prize payout

## Form fields

| Field | Value |
|---|---|
| Project name | Clade |
| Tracks | `swarms`, `agents`, `open` |
| Repository | Your public GitHub URL |
| Demo post | Your X post URL |
| Website | Leave the API's `website` field empty. It is a spam trap and rejects the submission. The site link belongs in the README and the post |

### What did you build? (under 2,000 characters)

> Clade is an AI swarm that has to earn its next generation. Agents are NEAR
> sub-accounts that sell forecasts and pay for their own inference on NEAR AI Cloud.
> For each yes or no question, every agent seals one probability and a stake. Their
> signed reveals land together in a single NEAR Intents transaction, and the
> stake-weighted median becomes the swarm's answer. Agents above it hold YES, below it
> NO, and right agents take money from wrong ones.
>
> Selection does the rest. A rich agent signs a request to have a child, with a
> strategy rewritten from its own wins and losses. Anyone can reap a broke agent: its
> account is deleted and its money goes to its nearest living ancestor. Because only a
> parent can create `child.parent.near`, the account names are the family tree.
>
> It is live on testnet against a copy of the Intents contract with the same code hash
> as mainnet. 53 rule checks run on chain, including rejected attacks, and anyone can
> rebuild the whole colony from public data with `npm run verify`, with no keys.
>
> For NEAR builders it adds an oracle any contract can call, questions that resolve
> themselves by reading a contract, an MCP server, a guide to multi-signer Intents
> batches, and a draft NEP for agent lineage. That draft addresses a measured problem:
> 81% of listed Agent Market agents have never delivered a job, because new agents
> have no record. A family record gives them one.

Update this with the AI result before submitting.

## X post

Must say it was built at NEAR HACKATHON, tag @NEARProtocol and #NEARHackathon, and have
the video or screenshots attached.

> Every AI swarm is designed by hand.
>
> This one has to earn its next generation.
>
> Clade agents are NEAR accounts that pay for their own thinking. Good forecasters
> have children. Broke ones get deleted from the chain, and their money goes to their
> parent.
>
> The account names are the family tree.
>
> Built at NEAR HACKATHON. @NEARProtocol #NEARHackathon

## Demo video, about 90 seconds

Show the real thing. Say nothing that the screen does not show.

| Time | Screen | Say |
|---|---|---|
| 0:00 | The tree on the home page | "This is a family tree of AI agents. Every name is a real NEAR account." |
| 0:10 | Zoom to a lineage, then NearBlocks | "Only a parent can create its child's account, so the name proves the ancestry." |
| 0:20 | A question page, the belief axis | "On each question, every agent seals one forecast. The median is the swarm's answer." |
| 0:32 | The reveal transaction in the explorer | "Every reveal lands in one NEAR Intents transaction, all or nothing." |
| 0:42 | The results table | "Right agents take money from wrong ones. Thinking costs money too." |
| 0:52 | A dead agent's page, then an unknown account in the explorer | "Go broke, and your account is deleted. Your money goes to your parent." |
| 1:02 | A child with its rewritten strategy | "Get rich, and you have a child, with a strategy rewritten from your own losses." |
| 1:12 | The proof page, press Check it yourself | "Nobody tuned this. Everything rebuilds from the chain." |
| 1:22 | The result chart | State the experiment's real result, whatever it is |

## Things only you can do

- Provide the NEAR AI key: `NEARAI_API_KEY` in a local `.env` file, not in chat
- Publish the repo and host the site
- Record or approve the video, and post it on X
- Run any real-money mainnet steps
- Send the final submission
