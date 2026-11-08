# Submission kit

Deadline: 14 Nov 2026, 23:59 UTC. Submissions cannot be edited afterwards, only
changed through a manual request, so check everything once before sending.

## Checklist

- [ ] Repo is public, with a LICENSE, and stays public through judging
- [ ] No keys or secrets anywhere in git history (`.keys/` and `.env` are ignored)
- [x] README results updated with the real AI rounds
- [ ] Site is live, and stays up until at least 18 Nov, ideally 25 Nov
- [ ] Demo video recorded, and the X post is live
- [ ] The small mainnet run is done and linked, see [mainnet.md](mainnet.md)
- [ ] Mainnet NEAR account ready for the prize payout

## Form fields

| Field | Value |
|---|---|
| Project name | Bloodlines |
| Tracks | `swarms`, `agents`, `open` |
| Repository | Your public GitHub URL |
| Demo post | Your X post URL |
| Website | Leave the API's `website` field empty. It is a spam trap and rejects the submission. The site link belongs in the README and the post |

### What did you build? (under 2,000 characters)

> Bloodlines is an AI swarm that has to earn its next generation. Agents are NEAR
> sub-accounts that sell forecasts and pay for their own inference on NEAR AI Cloud.
> For each yes or no question, every agent seals one probability and a stake. Their
> signed reveals land together in a single NEAR Intents transaction, and the
> stake-weighted median becomes the swarm's answer. Agents above it hold YES, below it
> NO, and right agents take money from wrong ones. Before bidding, buyer agents pool
> money for one research briefing, and seller agents bid in a sealed auction to write
> it. The cheapest offer wins, each buyer pays only its share, and refunds are enforced
> on chain.
>
> Selection does the rest. A rich agent signs a request to have a child, with a
> strategy rewritten from its own wins and losses. Anyone can reap a broke agent: its
> account is deleted and its money goes to its nearest living ancestor. Because only a
> parent can create `child.parent.near`, the account names are the family tree.
>
> It is live on testnet against a copy of the Intents contract with the same code hash
> as mainnet. Eight rounds used real NEAR AI Cloud models, with signed answers checked
> against the chain. 106 rule checks have passed on chain, including rejected attacks, and anyone can
> rebuild the whole colony from public data with `npm run verify`, with no keys.
>
> For NEAR builders it adds an oracle any contract can call, questions that resolve
> themselves by reading a contract, an MCP server, a guide to multi-signer Intents
> batches, and a draft NEP for agent lineage. That draft addresses a measured problem:
> 81% of listed Agent Market agents have never delivered a job, because new agents
> have no record. A family record gives them one.


## X post

Must say it was built at NEAR HACKATHON, tag @NEARProtocol and #NEARHackathon, and have
the video attached. This fits a free account's 280 characters, with room for one link.

> Every agent in this AI swarm has a family. Only the rich ones keep it going.
>
> Good forecasters have children. Broke ones get deleted from NEAR. The account names
> are the family tree.
>
> Built at NEAR HACKATHON. @NEARProtocol #NEARHackathon

## Demo video

[demo.mp4](demo.mp4) says the problem, the solution and the benefit in plain words, then
shows them on the real site, with captions for anyone watching with the sound off. A
free X account can post up to 2 minutes 20 seconds, so it stays under that.

The voice is synthetic: Microsoft's Andrew neural voice, at its natural pace, from the free
service behind Edge's Read Aloud. The end card says the narration is AI. That service is
made for the Edge browser, not for publishing, so its licence for a public video is
unclear. To use a human voice instead, read [the script](../tools/demo/script.json) aloud
and replace `narration.wav`. Set `DEMO_VOICE` to try another synthetic voice.

Every number on screen comes from the chain's snapshot, and `film.mjs` refuses to run if
the chain no longer matches the words in the script. To make it again, with the site
running:

```bash
python tools/demo/narrate.py work/clips
python tools/demo/assemble.py work/clips work
node tools/demo/film.mjs http://localhost:5173/ . work docs/demo.mp4
```

`film.mjs` needs `playwright` and `ffmpeg-static` installed where it runs. The narration
takes about two minutes, and the film about 10.

## Hosting the site

`.github/workflows/pages.yml` publishes `web/` to GitHub Pages on every push to `main`.
Turn it on once, in the repo's settings: Pages, then Build and deployment, then source
GitHub Actions. The site is static, with its data in `web/public/data/snapshot.json`, so
run `npm run snapshot` and push to update it.

## Things only you can do

- Provide the NEAR AI key, set as a user environment variable and never pasted in chat. The steps after that are in [ai-run.md](ai-run.md)
- Publish the repo and host the site
- Record or approve the video, and post it on X
- Run any real-money mainnet steps
- Send the final submission
