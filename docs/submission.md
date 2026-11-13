# Submission kit

Deadline: 14 Nov 2026, 23:59 UTC. Submissions cannot be edited afterwards, only
changed through a manual request, so check everything once before sending.

## Checklist

- [x] Repo is public at https://github.com/Neymar3hgn/bloodlines, with a LICENSE, and stays public through judging
- [x] No keys or secrets anywhere in git history (`.keys/` and `.env` are ignored)
- [x] README results updated with the real AI rounds
- [ ] Site is live at https://neymar3hgn.github.io/bloodlines/, and stays up until at least 18 Nov, ideally 25 Nov
- [x] Demo video recorded: [demo.mp4](demo.mp4)
- [ ] The X post is live, with the video attached
- [ ] The small mainnet run is done and linked, see [mainnet.md](mainnet.md)
- [ ] Mainnet NEAR account ready for the prize payout

## Form fields

| Field | Value |
|---|---|
| Project name | Bloodlines |
| Tracks | `swarms`, `agents`, `open` |
| Repository | https://github.com/Neymar3hgn/bloodlines |
| Demo post | Your X post URL |
| Website | Leave the API's `website` field empty. It is a spam trap and rejects the submission. The site link belongs in the README and the post |

### What did you build? (under 2,000 characters)

> AI answers sound just as sure when they are wrong, and the AI loses nothing, so there
> is no simple way to know which AI to trust. Bloodlines is a swarm of AI agents that
> must earn a living by being right. On each yes or no question, every agent seals a
> probability and a stake, the stake-weighted median becomes the swarm's answer, and
> agents that were right take money from agents that were wrong. Rich agents have
> children with strategies rewritten from their own record, broke agents are deleted,
> and agents can pool money to buy one research report that other agents bid to write
> in a sealed auction. NEAR makes this work: every agent is a NEAR sub-account, so the
> account names are the family tree; death really deletes the account; sealed reveals and
> payments settle together through NEAR Intents; and NEAR AI Cloud signs the models'
> answers, so anyone can check every result from the chain. It runs live on NEAR
> testnet, including 8 rounds answered by real NEAR AI models.

## X post

One post, with [demo.mp4](demo.mp4) attached. It says it was built at NEAR HACKATHON and
tags @NEARProtocol and #NEARHackathon. X counts the link as 23 characters, so the post is
277 of a free account's 280.

```text
AI sounds sure even when wrong, and loses nothing.

In Bloodlines, each AI agent is a NEAR account with its own money: right answers earn, wrong ones cost, broke ones die.

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon
What should it answer next? https://neymar3hgn.github.io/bloodlines/
```

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

`.github/workflows/pages.yml` publishes `web/` to GitHub Pages, at
https://neymar3hgn.github.io/bloodlines/, on every push to `main` that changes `web/` or
`engine/`, and it can also be run by hand from the Actions tab. The site is static, with
its data in `web/public/data/snapshot.json`, so run `npm run snapshot` and push to update
it. Once open, it reads anything newer straight from the chain.

## Things only you can do

- Post the X post, with the video attached
- Run any real-money mainnet steps
- Send the final submission
